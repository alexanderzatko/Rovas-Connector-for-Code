// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { TimeTracker } from './timeTracking/timeTracker';
import { showAdjustTimeWebview } from './gui/adjustTimeWebview';
import { exec } from 'child_process';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Read inactivity timeout from configuration
	const config = vscode.workspace.getConfiguration('rovas-connector');
	const inactivityTimeout = config.get<number>('inactivityTimeout', 30);

	// Initialize time tracker
	const tracker = new TimeTracker(context);
	tracker.setInactivityTolerance(inactivityTimeout);
	tracker.start();

	// Status bar button: Adjust time
	const adjustTimeButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	adjustTimeButton.text = '$(edit) Adjust Time';
	adjustTimeButton.command = 'rovas-connector.adjustTrackedTime';
	adjustTimeButton.tooltip = 'Adjust tracked time';
	adjustTimeButton.show();
	context.subscriptions.push(adjustTimeButton);

	// Status bar button: Reset time
	const resetTimeButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
	resetTimeButton.text = '$(trash) Reset Time';
	resetTimeButton.command = 'rovas-connector.resetTimer';
	resetTimeButton.tooltip = 'Reset tracked time';
	resetTimeButton.show();
	context.subscriptions.push(resetTimeButton);
	// Adjust tracked time command (hours, minutes, seconds)
	const adjustTimeDisposable = vscode.commands.registerCommand('rovas-connector.adjustTrackedTime', async () => {
		showAdjustTimeWebview(context, tracker);
	});
	context.subscriptions.push(adjustTimeDisposable);
	// Show timing started dialog (dismissible, auto-close after 2s)
	const timingMsg = vscode.window.showInformationMessage('Rovas Connector: Time tracking started.', { modal: false }, 'Dismiss');
	setTimeout(() => {
		timingMsg.then(() => {
			// No action needed, just let it close
		});
		vscode.commands.executeCommand('workbench.action.closeMessages');
	}, 2000);

	// Listen for configuration changes
	vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('rovas-connector.inactivityTimeout')) {
			const newTimeout = vscode.workspace.getConfiguration('rovas-connector').get<number>('inactivityTimeout', 30);
			tracker.setInactivityTolerance(newTimeout);
			vscode.window.showInformationMessage(`Rovas Connector inactivity timeout updated to ${newTimeout} seconds.`);
		}
	});

	// Status bar item for tracked time
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = 'Rovas: 0m 0s';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	let wasInactive = false;
	setInterval(() => {
		const seconds = tracker.getTrackedSeconds();
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		const now = Date.now();
		const inactive = (now - (tracker as any).lastActivity) / 1000 >= (tracker as any).inactivityTolerance;

		// LED-like dot and state
		let dot = '●';
		let stateText = '';
		let color = '';
		if (inactive) {
			stateText = 'paused';
			color = '#FFA500'; // orange
		} else {
			stateText = 'timing';
			color = '#00FF00'; // green
		}
		statusBarItem.text = `$(primitive-dot) Rovas: ${minutes}m ${remainingSeconds}s (${stateText})`;
		statusBarItem.color = color;

	// No dialog when resuming; status bar is enough
		wasInactive = inactive;
	}, 1000);

	// Show tracked time command
	const showTimeDisposable = vscode.commands.registerCommand('rovas-connector.showTrackedTime', () => {
		const seconds = tracker.getTrackedSeconds();
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		vscode.window.showInformationMessage(`Tracked time: ${minutes}m ${remainingSeconds}s`);
	});
	context.subscriptions.push(showTimeDisposable);

	// Hello World command
	const helloDisposable = vscode.commands.registerCommand('rovas-connector.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Rovas Connector!');
	});
	context.subscriptions.push(helloDisposable);

	// Reset timer command
	const resetDisposable = vscode.commands.registerCommand('rovas-connector.resetTimer', () => {
		tracker.reset();
		vscode.window.showInformationMessage('Time tracker reset.');
	});
	context.subscriptions.push(resetDisposable);

	// Command to manage Project ID history
	const manageProjectIdsDisposable = vscode.commands.registerCommand('rovas-connector.manageProjectIds', async () => {
		let projectIdHistory: string[] = context.globalState.get('projectIdHistory', []);
		if (projectIdHistory.length === 0) {
			vscode.window.showInformationMessage('No Project IDs to manage.');
			return;
		}
		const items = projectIdHistory.map(id => ({ label: id, description: 'Remove this Project ID' }));
		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select Project ID to remove from history',
			canPickMany: true,
			ignoreFocusOut: true
		});
		if (selected && selected.length > 0) {
			const idsToRemove = selected.map(item => item.label);
			projectIdHistory = projectIdHistory.filter(id => !idsToRemove.includes(id));
			await context.globalState.update('projectIdHistory', projectIdHistory);
			vscode.window.showInformationMessage('Selected Project IDs removed from history.');
		}
	});
	context.subscriptions.push(manageProjectIdsDisposable);

	// Listen for git commit events using polling for HEAD changes
	const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	if (gitExtension) {
		const api = gitExtension.getAPI(1);
		for (const repo of api.repositories) {
			let lastHead = '';
			repo.getCommit('HEAD').then((commit: { hash?: string }) => {
				lastHead = commit?.hash || '';
			});
			setInterval(async () => {
				const commit = await repo.getCommit('HEAD');
				const newHead = commit?.hash || '';
				if (newHead && newHead !== lastHead) {
					lastHead = newHead;
					// Get settings
					const config = vscode.workspace.getConfiguration('rovas-connector');
					const apiKey = config.get<string>('apiKey', '');
					const apiToken = config.get<string>('apiToken', '');
					const projectId = config.get<string>('projectId', '');
					const paidStatus = config.get<boolean>('paidStatus', false);
					if (!apiKey || !apiToken || !projectId || !paidStatus) {
						return;
					}
					const remoteUrl = repo.state.remotes[0]?.fetchUrl || repo.state.remotes[0]?.pushUrl;
					let commitUrl = '';
					if (remoteUrl && newHead) {
						if (remoteUrl.includes('github.com')) {
							commitUrl = `${remoteUrl.replace(/\.git$/, '')}/commit/${newHead}`;
						} else if (remoteUrl.includes('gitlab.com')) {
							commitUrl = `${remoteUrl.replace(/\.git$/, '')}/-/commit/${newHead}`;
						} else if (remoteUrl.includes('bitbucket.org')) {
							commitUrl = `${remoteUrl.replace(/\.git$/, '')}/commits/${newHead}`;
						} else {
							commitUrl = `${remoteUrl}/commit/${newHead}`;
						}
					}
					const result = await vscode.window.showInformationMessage(
						`Do you want to create a Rovas work report for commit ${newHead}?`,
						'Yes', 'No'
					);
					if (result === 'Yes') {
						// Project ID selection logic
						let projectIdHistory: string[] = context.globalState.get('projectIdHistory', []);
						const configProjectId = config.get<string>('projectId', '');
						let quickPickItems = projectIdHistory.map(id => ({ label: id, description: id === configProjectId ? 'Current (from settings)' : '' }));
						if (!projectIdHistory.includes(configProjectId) && configProjectId) {
							quickPickItems.unshift({ label: configProjectId, description: 'Current (from settings)' });
						}
						quickPickItems.push({ label: 'Enter new Project ID...', description: 'Type a new Rovas Project ID' });
						const selected = await vscode.window.showQuickPick(quickPickItems, {
							placeHolder: 'Select or enter Rovas Project ID for this work report',
							ignoreFocusOut: true
						});
						let selectedProjectId = configProjectId;
						if (selected) {
							if (selected.label === 'Enter new Project ID...') {
								const input = await vscode.window.showInputBox({
									prompt: 'Enter new Rovas Project ID',
									value: '',
									ignoreFocusOut: true
								});
								if (input) {
									selectedProjectId = input;
									if (!projectIdHistory.includes(input)) {
										projectIdHistory.push(input);
										await context.globalState.update('projectIdHistory', projectIdHistory);
									}
								} else {
									// User cancelled input
									return;
								}
							} else {
								selectedProjectId = selected.label;
							}
						} else {
							// User cancelled quick pick
							return;
						}
						const trackedSeconds = tracker.getTrackedSeconds();
						const trackedHours = Math.max(0.01, Number((trackedSeconds / 3600).toFixed(2)));
						const wrPayload = {
							wr_classification: 1645,
							wr_description: `VS Code commit: ${newHead}. Proof: ${commitUrl}`,
							wr_activity_name: 'Programming',
							wr_hours: trackedHours,
							wr_web_address: commitUrl,
							parent_project_nid: selectedProjectId,
							date_started: Math.floor(Date.now() / 1000),
							access_token: Math.random().toString(36).substring(2, 18),
							publish_status: 1
						};
						try {
							const response = await fetch('https://dev.rovas.app/rovas/rules/rules_proxy_create_work_report', {
								method: 'POST',
								headers: {
									'Content-Type': 'application/json',
									'Accept': 'application/json',
									'API-KEY': apiKey,
									'TOKEN': apiToken
								},
								body: JSON.stringify(wrPayload)
							});
							const textResponse = await response.text();
							if (!response.ok) {
								throw new Error('Server error ' + response.status + ': ' + textResponse);
							}
							let rovasReportId;
							try {
								const parsed = JSON.parse(textResponse);
								rovasReportId = parsed.created_wr_nid;
							} catch (e) {
								console.warn('[ROVAS] Failed to parse JSON response:', e, textResponse);
							}
							if (rovasReportId) {
								vscode.window.showInformationMessage('Rovas work report created! Rovas ID: ' + rovasReportId);
								// Charge usage fee after successful work report
								const laborValue = trackedHours * 10;
								const usageFee = Number((laborValue * 0.03).toFixed(2));
								const feePayload = {
									project_id: 429681, // project "Rovas Connector for ID"
									wr_id: rovasReportId,
									usage_fee: usageFee,
									note: "3% usage fee, levied by the 'Rovas Connector for ID' project"
								};
								try {
									const feeResponse = await fetch('https://dev.rovas.app/rovas/rules/rules_proxy_create_aur', {
										method: 'POST',
										headers: {
											'Content-Type': 'application/json',
											'Accept': 'application/json',
											'API-KEY': apiKey,
											'TOKEN': apiToken
										},
										body: JSON.stringify(feePayload)
									});
									// No user messages for fee API call
								} catch (feeError) {
									// No user messages for fee API call
								}
							} else {
								vscode.window.showWarningMessage('Work report submitted, but Rovas ID was not found in the response.');
							}
						} catch (error) {
							const errorMsg = (typeof error === 'object' && error !== null && 'message' in error) ? (error as any).message : String(error);
							vscode.window.showErrorMessage('Error creating Rovas work report: ' + errorMsg);
						}
					}
				}
			}, 5000); // Poll every 5 seconds
		}
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
