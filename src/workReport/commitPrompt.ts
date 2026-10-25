// commitPrompt.ts
// After a git commit, ask (modally) whether to create a Rovas work report

import * as vscode from 'vscode';
import { TimeTracker } from '../timeTracking/timeTracker';

type GitRepository = {
	state: {
		HEAD?: { commit?: string } | undefined;
		remotes: Array<{ fetchUrl?: string; pushUrl?: string }>;
		onDidChange: vscode.Event<void>;
	};
	getCommit: (ref: string) => Thenable<{ hash?: string; message?: string }>;
	onDidCommit?: vscode.Event<void>;
};

type GitAPI = {
	repositories: GitRepository[];
	onDidOpenRepository: vscode.Event<GitRepository>;
	onDidCloseRepository: vscode.Event<GitRepository>;
};

export function registerCommitWorkReportPrompt(
	context: vscode.ExtensionContext,
	tracker: TimeTracker
): void {
	const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	if (!gitExtension) {
		return;
	}

	const api = gitExtension.getAPI(1) as GitAPI;
	const watched = new Set<GitRepository>();

	const watchRepository = (repo: GitRepository) => {
		if (watched.has(repo)) {
			return;
		}
		watched.add(repo);

		let lastHead = repo.state.HEAD?.commit || '';

		const handlePossibleCommit = async () => {
			const newHead = repo.state.HEAD?.commit || '';
			if (!newHead || newHead === lastHead) {
				return;
			}
			lastHead = newHead;

			const reportEvents = vscode.workspace
				.getConfiguration('rovas-connector')
				.get<string[]>('reportEvents', ['onCommit']);
			if (!reportEvents.includes('onCommit')) {
				return;
			}

			await promptForWorkReport(context, tracker, repo, newHead);
		};

		if (typeof repo.onDidCommit === 'function') {
			context.subscriptions.push(repo.onDidCommit(() => {
				void handlePossibleCommit();
			}));
		}

		context.subscriptions.push(repo.state.onDidChange(() => {
			void handlePossibleCommit();
		}));
	};

	for (const repo of api.repositories) {
		watchRepository(repo);
	}
	context.subscriptions.push(api.onDidOpenRepository((repo) => watchRepository(repo)));
	context.subscriptions.push(api.onDidCloseRepository((repo) => watched.delete(repo)));
}

async function promptForWorkReport(
	context: vscode.ExtensionContext,
	tracker: TimeTracker,
	repo: GitRepository,
	commitHash: string
): Promise<void> {
	const config = vscode.workspace.getConfiguration('rovas-connector');
	const apiKey = await context.secrets.get('rovas-connector.apiKey');
	const apiToken = await context.secrets.get('rovas-connector.apiToken');
	const projectId = config.get<string>('projectId', '');
	const paidStatus = config.get<boolean>('paidStatus', false);

	const shortHash = commitHash.slice(0, 7);
	const trackedSeconds = tracker.getTrackedSeconds();
	const trackedLabel = formatDuration(trackedSeconds);

	let commitMessage = '';
	try {
		const commit = await repo.getCommit(commitHash);
		commitMessage = (commit.message || '').split('\n')[0].trim();
	} catch {
		// optional
	}

	const missing: string[] = [];
	if (!apiKey) { missing.push('API Key'); }
	if (!apiToken) { missing.push('API Token'); }
	if (!projectId) { missing.push('Project ID'); }
	if (!paidStatus) { missing.push('unpaid-work confirmation'); }

	if (missing.length > 0) {
		const result = await vscode.window.showInformationMessage(
			`Commit ${shortHash} detected.${commitMessage ? `\n\n“${commitMessage}”` : ''}\n\n` +
				`Tracked time: ${trackedLabel}\n\n` +
				`To create a Rovas work report, finish setup first (missing: ${missing.join(', ')}).`,
			{ modal: true },
			'Open Settings',
			'Not now'
		);
		if (result === 'Open Settings') {
			await vscode.commands.executeCommand('rovas-connector.openSettings');
		}
		return;
	}

	const result = await vscode.window.showInformationMessage(
		`Create a Rovas work report for commit ${shortHash}?` +
			(commitMessage ? `\n\n“${commitMessage}”` : '') +
			`\n\nTracked time to report: ${trackedLabel}` +
			`\n\nA 3% usage fee applies to each report.`,
		{ modal: true },
		'Create work report',
		'Skip'
	);

	if (result !== 'Create work report') {
		return;
	}

	const selectedProjectId = await pickProjectId(context, projectId);
	if (!selectedProjectId) {
		return;
	}

	await submitWorkReport({
		context,
		tracker,
		repo,
		commitHash,
		apiKey: apiKey!,
		apiToken: apiToken!,
		projectId: selectedProjectId,
		trackedSeconds
	});
}

async function pickProjectId(
	context: vscode.ExtensionContext,
	configProjectId: string
): Promise<string | undefined> {
	let projectIdHistory: string[] = context.globalState.get('projectIdHistory', []);
	const quickPickItems = projectIdHistory.map((id) => ({
		label: id,
		description: id === configProjectId ? 'Current (from settings)' : ''
	}));
	if (configProjectId && !projectIdHistory.includes(configProjectId)) {
		quickPickItems.unshift({ label: configProjectId, description: 'Current (from settings)' });
	}
	quickPickItems.push({ label: 'Enter new Project ID...', description: 'Type a new Rovas Project ID' });

	const selected = await vscode.window.showQuickPick(quickPickItems, {
		placeHolder: 'Select Rovas Project ID for this work report',
		ignoreFocusOut: true,
		title: 'Rovas work report'
	});
	if (!selected) {
		return undefined;
	}

	if (selected.label === 'Enter new Project ID...') {
		const input = await vscode.window.showInputBox({
			prompt: 'Enter new Rovas Project ID',
			ignoreFocusOut: true,
			title: 'Rovas work report'
		});
		if (!input) {
			return undefined;
		}
		if (!projectIdHistory.includes(input)) {
			projectIdHistory = [...projectIdHistory, input];
			await context.globalState.update('projectIdHistory', projectIdHistory);
		}
		return input;
	}

	return selected.label;
}

async function submitWorkReport(opts: {
	context: vscode.ExtensionContext;
	tracker: TimeTracker;
	repo: GitRepository;
	commitHash: string;
	apiKey: string;
	apiToken: string;
	projectId: string;
	trackedSeconds: number;
}): Promise<void> {
	const { tracker, repo, commitHash, apiKey, apiToken, projectId, trackedSeconds } = opts;
	const trackedHours = Math.max(0.01, Number((trackedSeconds / 3600).toFixed(2)));
	const workspaceName = vscode.workspace.name || 'workspace';
	const commitUrl = buildCommitUrl(repo, commitHash);

	const wrPayload = {
		wr_classification: 1645,
		wr_description: `Cursor/VS Code commit: ${commitHash}. Proof: ${commitUrl}`,
		wr_activity_name: `Programming work on "${workspaceName}"`,
		wr_hours: trackedHours,
		wr_web_address: commitUrl,
		parent_project_nid: projectId,
		date_started: Math.floor(Date.now() / 1000),
		access_token: Math.random().toString(36).substring(2, 18),
		publish_status: 1
	};

	try {
		const response = await fetch('https://rovas.app/rovas/rules/rules_proxy_create_work_report', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				'API-KEY': apiKey,
				TOKEN: apiToken
			},
			body: JSON.stringify(wrPayload)
		});
		const textResponse = await response.text();
		if (!response.ok) {
			throw new Error('Server error ' + response.status + ': ' + textResponse);
		}

		let rovasReportId: string | undefined;
		try {
			const parsed = JSON.parse(textResponse);
			rovasReportId = parsed.created_wr_nid;
		} catch (e) {
			console.warn('[ROVAS] Failed to parse JSON response:', e, textResponse);
		}

		if (rovasReportId) {
			vscode.window.showInformationMessage('Rovas work report created! Rovas ID: ' + rovasReportId);
			tracker.reset();

			const laborValue = trackedHours * 10;
			const usageFee = Number((laborValue * 0.03).toFixed(2));
			const feePayload = {
				project_id: 437627,
				wr_id: rovasReportId,
				usage_fee: usageFee,
				note: "3% usage fee, levied by the 'Rovas Connector for Code' project"
			};
			try {
				await fetch('https://rovas.app/rovas/rules/rules_proxy_create_aur', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Accept: 'application/json',
						'API-KEY': apiKey,
						TOKEN: apiToken
					},
					body: JSON.stringify(feePayload)
				});
			} catch {
				// Fee charge is best-effort; don't surface to the user
			}
		} else {
			vscode.window.showWarningMessage(
				'Work report submitted, but Rovas ID was not found in the response.'
			);
		}
	} catch (error) {
		const errorMsg =
			typeof error === 'object' && error !== null && 'message' in error
				? (error as Error).message
				: String(error);
		vscode.window.showErrorMessage('Error creating Rovas work report: ' + errorMsg);
	}
}

function buildCommitUrl(repo: GitRepository, commitHash: string): string {
	const remoteUrl = repo.state.remotes[0]?.fetchUrl || repo.state.remotes[0]?.pushUrl;
	if (!remoteUrl) {
		return '';
	}
	const cleaned = remoteUrl.replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/');
	if (cleaned.includes('github.com')) {
		return `${cleaned}/commit/${commitHash}`;
	}
	if (cleaned.includes('gitlab.com')) {
		return `${cleaned}/-/commit/${commitHash}`;
	}
	if (cleaned.includes('bitbucket.org')) {
		return `${cleaned}/commits/${commitHash}`;
	}
	return `${cleaned}/commit/${commitHash}`;
}

function formatDuration(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return `${hours}h ${minutes}m ${seconds}s`;
	}
	return `${minutes}m ${seconds}s`;
}
