// commitPrompt.ts
// After a git commit, ask whether to create a Rovas work report

import * as vscode from 'vscode';
import { TimeTracker } from '../timeTracking/timeTracker';
import { showWorkReportPrompt } from '../gui/workReportWebview';
import { getSavedProjects } from '../projects/projectStore';

type GitRepository = {
	rootUri?: vscode.Uri;
	state: {
		HEAD?: { commit?: string } | undefined;
		remotes: Array<{ fetchUrl?: string; pushUrl?: string }>;
		onDidChange: vscode.Event<void>;
	};
	getCommit: (ref: string) => Thenable<{ hash?: string; message?: string }>;
	onDidCommit?: vscode.Event<void>;
};

type GitAPI = {
	state: 'uninitialized' | 'initialized';
	onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
	repositories: GitRepository[];
	onDidOpenRepository: vscode.Event<GitRepository>;
	onDidCloseRepository: vscode.Event<GitRepository>;
};

const POLL_INTERVAL_MS = 3000;
const output = vscode.window.createOutputChannel('Rovas Connector');
/** Avoid double prompts when both an event and the poll see the same HEAD change */
const promptedCommits = new Set<string>();

export function registerCommitWorkReportPrompt(
	context: vscode.ExtensionContext,
	tracker: TimeTracker
): void {
	void setupGitWatchers(context, tracker);
}

function commitPromptKey(repo: GitRepository, commitHash: string): string {
	return `${repoRoot(repo)}::${commitHash}`;
}

async function setupGitWatchers(
	context: vscode.ExtensionContext,
	tracker: TimeTracker
): Promise<void> {
	const ext = vscode.extensions.getExtension('vscode.git');
	if (!ext) {
		output.appendLine('[git] vscode.git extension not found — commit prompts disabled.');
		return;
	}

	try {
		const exports = ext.isActive ? ext.exports : await ext.activate();
		const api = exports.getAPI(1) as GitAPI;
		const watched = new Map<GitRepository, { lastHead: string; ready: boolean }>();

		const watchRepository = (repo: GitRepository) => {
			if (watched.has(repo)) {
				return;
			}

			const initialHead = repo.state.HEAD?.commit || '';
			watched.set(repo, { lastHead: initialHead, ready: Boolean(initialHead) });
			output.appendLine(
				`[git] watching ${repoRoot(repo)} (HEAD ${initialHead ? initialHead.slice(0, 7) : 'unknown'})`
			);

			const handlePossibleCommit = async (source: string) => {
				const entry = watched.get(repo);
				if (!entry) {
					return;
				}

				const newHead = repo.state.HEAD?.commit || '';
				if (!newHead) {
					return;
				}

				// First time we learn HEAD (repo model still loading) — baseline only, do not prompt
				if (!entry.ready) {
					entry.lastHead = newHead;
					entry.ready = true;
					output.appendLine(`[git] baseline HEAD ${newHead.slice(0, 7)} for ${repoRoot(repo)}`);
					return;
				}

				if (newHead === entry.lastHead) {
					return;
				}

				const previous = entry.lastHead;
				entry.lastHead = newHead;
				output.appendLine(
					`[git] HEAD changed ${previous.slice(0, 7) || '(none)'} → ${newHead.slice(0, 7)} ` +
						`in ${repoRoot(repo)} (${source})`
				);

				const reportEvents = vscode.workspace
					.getConfiguration('rovas-connector')
					.get<string[]>('reportEvents', ['onCommit']);
				if (!reportEvents.includes('onCommit')) {
					return;
				}

				await promptForWorkReportOnce(context, tracker, repo, newHead);
			};

			if (repo.onDidCommit) {
				context.subscriptions.push(
					repo.onDidCommit(() => {
						void handlePossibleCommit('onDidCommit');
					})
				);
			}

			context.subscriptions.push(
				repo.state.onDidChange(() => {
					void handlePossibleCommit('state.onDidChange');
				})
			);
		};

		const watchAll = (reason: string) => {
			output.appendLine(`[git] scan repositories (${reason}): ${api.repositories.length} found`);
			for (const repo of api.repositories) {
				watchRepository(repo);
			}
		};

		const startWatching = () => {
			watchAll('initialized');

			context.subscriptions.push(
				api.onDidOpenRepository((repo) => {
					output.appendLine(`[git] repository opened: ${repoRoot(repo)}`);
					watchRepository(repo);
				})
			);
			context.subscriptions.push(
				api.onDidCloseRepository((repo) => {
					output.appendLine(`[git] repository closed: ${repoRoot(repo)}`);
					watched.delete(repo);
				})
			);
			context.subscriptions.push(
				vscode.workspace.onDidChangeWorkspaceFolders(() => {
					// Git may open/close repos asynchronously after folder changes
					setTimeout(() => watchAll('workspace folders changed'), 1000);
				})
			);

			// Reliable backup for multi-root + commits made via CLI / GitHub Desktop /
			// Source Control UI that don't always emit onDidCommit promptly.
			const poll = setInterval(() => {
				for (const repo of api.repositories) {
					if (!watched.has(repo)) {
						watchRepository(repo);
					}
					const entry = watched.get(repo);
					const head = repo.state.HEAD?.commit || '';
					if (!entry || !head || head === entry.lastHead) {
						continue;
					}
					if (!entry.ready) {
						entry.lastHead = head;
						entry.ready = true;
						continue;
					}
					const previous = entry.lastHead;
					entry.lastHead = head;
					output.appendLine(
						`[git] HEAD changed ${previous.slice(0, 7) || '(none)'} → ${head.slice(0, 7)} ` +
							`in ${repoRoot(repo)} (poll)`
					);
					const reportEvents = vscode.workspace
						.getConfiguration('rovas-connector')
						.get<string[]>('reportEvents', ['onCommit']);
					if (reportEvents.includes('onCommit')) {
						void promptForWorkReportOnce(context, tracker, repo, head);
					}
				}
			}, POLL_INTERVAL_MS);

			context.subscriptions.push({ dispose: () => clearInterval(poll) });
		};

		if (api.state === 'initialized') {
			startWatching();
		} else {
			output.appendLine('[git] waiting for git API to initialize…');
			context.subscriptions.push(
				api.onDidChangeState((state) => {
					if (state === 'initialized') {
						startWatching();
					}
				})
			);
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		output.appendLine(`[git] failed to set up commit watchers: ${msg}`);
	}
}

function repoRoot(repo: GitRepository): string {
	return repo.rootUri?.fsPath || '(unknown repo)';
}

async function promptForWorkReportOnce(
	context: vscode.ExtensionContext,
	tracker: TimeTracker,
	repo: GitRepository,
	commitHash: string
): Promise<void> {
	const key = commitPromptKey(repo, commitHash);
	if (promptedCommits.has(key)) {
		return;
	}
	promptedCommits.add(key);
	// Bound memory if someone makes many commits in a long session
	if (promptedCommits.size > 200) {
		const first = promptedCommits.values().next().value;
		if (first) {
			promptedCommits.delete(first);
		}
	}
	try {
		await promptForWorkReport(context, tracker, repo, commitHash);
	} catch (error) {
		promptedCommits.delete(key);
		throw error;
	}
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
	const defaultProjectId = config.get<string>('projectId', '');
	const paidStatus = config.get<boolean>('paidStatus', false);
	const savedProjects = getSavedProjects(context);

	const shortHash = commitHash.slice(0, 7);
	const trackedSeconds = tracker.getTrackedSeconds();
	const trackedLabel = formatDuration(trackedSeconds);

	let commitMessage = '';
	let commitSubject = '';
	try {
		const commit = await repo.getCommit(commitHash);
		commitMessage = (commit.message || '').trim();
		commitSubject = commitMessage.split('\n')[0].trim();
	} catch {
		// optional
	}

	const missing: string[] = [];
	if (!apiKey) { missing.push('API Key'); }
	if (!apiToken) { missing.push('API Token'); }
	if (!defaultProjectId && savedProjects.length === 0) { missing.push('Project ID'); }
	if (!paidStatus) { missing.push('unpaid-work confirmation'); }

	if (missing.length > 0) {
		const result = await vscode.window.showInformationMessage(
			`Commit ${shortHash} detected in ${repoRoot(repo)}.` +
				(commitSubject ? `\n\n“${commitSubject}”` : '') +
				`\n\nTracked time: ${trackedLabel}\n\n` +
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

	const choice = await showWorkReportPrompt(context, {
		shortHash,
		commitMessage: commitSubject,
		trackedLabel,
		defaultProjectId,
		apiKey: apiKey!,
		apiToken: apiToken!,
		repoLabel: repoRoot(repo),
	});

	if (!choice) {
		return;
	}

	await submitWorkReport({
		tracker,
		repo,
		commitHash,
		commitMessage,
		apiKey: apiKey!,
		apiToken: apiToken!,
		projectId: choice.projectId,
		projectTitle: choice.projectTitle,
		trackedSeconds
	});
}

async function submitWorkReport(opts: {
	tracker: TimeTracker;
	repo: GitRepository;
	commitHash: string;
	commitMessage: string;
	apiKey: string;
	apiToken: string;
	projectId: string;
	projectTitle: string;
	trackedSeconds: number;
}): Promise<void> {
	const { tracker, repo, commitHash, commitMessage, apiKey, apiToken, projectId, projectTitle, trackedSeconds } = opts;
	const trackedHours = Math.max(0.01, Number((trackedSeconds / 3600).toFixed(2)));
	const workspaceName = vscode.workspace.name || repoRoot(repo) || 'workspace';
	const commitUrl = buildCommitUrl(repo, commitHash);
	const projectLabel = projectTitle ? `${projectTitle} (#${projectId})` : `#${projectId}`;
	const descriptionBase = commitMessage || `Commit ${commitHash}`;
	const wrDescription =
		`${descriptionBase}\n\nThis report was created by the Rovas Connector for Cursor/VS extension`;

	const wrPayload = {
		wr_classification: 1578,
		wr_description: wrDescription,
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
			vscode.window.showInformationMessage(
				`Rovas work report created under ${projectLabel}. Rovas ID: ${rovasReportId}`
			);
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
