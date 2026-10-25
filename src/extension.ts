// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { TimeTracker } from './timeTracking/timeTracker';
import { showAdjustTimeWebview } from './gui/adjustTimeWebview';
import { showSettingsWebview } from './gui/settingsWebview';
import { registerCommitWorkReportPrompt } from './workReport/commitPrompt';
import { formatProjectLabel, getSavedProjects, removeSavedProject } from './projects/projectStore';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Command to set API Key
	const setApiKeyDisposable = vscode.commands.registerCommand('rovas-connector.setApiKey', async () => {
		const input = await vscode.window.showInputBox({
			prompt: 'Enter your Rovas API Key',
			password: true,
			ignoreFocusOut: true
		});
		if (input) {
			await context.secrets.store('rovas-connector.apiKey', input);
			vscode.window.showInformationMessage('Rovas API Key saved securely.');
		}
	});
	context.subscriptions.push(setApiKeyDisposable);

	// Command to set API Token
	const setApiTokenDisposable = vscode.commands.registerCommand('rovas-connector.setApiToken', async () => {
		const input = await vscode.window.showInputBox({
			prompt: 'Enter your Rovas API Token',
			password: true,
			ignoreFocusOut: true
		});
		if (input) {
			await context.secrets.store('rovas-connector.apiToken', input);
			vscode.window.showInformationMessage('Rovas API Token saved securely.');
		}
	});
	context.subscriptions.push(setApiTokenDisposable);
	// Read tracking preferences from configuration
	const config = vscode.workspace.getConfiguration('rovas-connector');
	const inactivityTimeout = config.get<number>('inactivityTimeout', 30);
	const pauseWhenIdle = config.get<boolean>('pauseWhenIdle', false);

	// Initialize time tracker
	const tracker = new TimeTracker(context);
	tracker.setInactivityTolerance(inactivityTimeout);
	tracker.setPauseWhenIdle(pauseWhenIdle);
	tracker.start();

	// Status bar button: Settings
	const settingsButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
	settingsButton.text = '$(gear) Rovas Settings';
	settingsButton.command = 'rovas-connector.openSettings';
	settingsButton.tooltip = 'Open Rovas Connector settings';
	settingsButton.show();
	context.subscriptions.push(settingsButton);

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

	// Settings GUI command
	const openSettingsDisposable = vscode.commands.registerCommand('rovas-connector.openSettings', async () => {
		tracker.bumpActivity();
		await showSettingsWebview(context);
	});
	context.subscriptions.push(openSettingsDisposable);

	// Adjust tracked time command (hours, minutes, seconds)
	const adjustTimeDisposable = vscode.commands.registerCommand('rovas-connector.adjustTrackedTime', async () => {
		tracker.bumpActivity();
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
		const cfg = vscode.workspace.getConfiguration('rovas-connector');
		if (e.affectsConfiguration('rovas-connector.inactivityTimeout')) {
			const newTimeout = cfg.get<number>('inactivityTimeout', 30);
			tracker.setInactivityTolerance(newTimeout);
		}
		if (e.affectsConfiguration('rovas-connector.pauseWhenIdle')) {
			tracker.setPauseWhenIdle(cfg.get<boolean>('pauseWhenIdle', false));
		}
	});

	// Status bar item for tracked time (driven by the tracker tick — same state used for counting)
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = 'Rovas: 0m 0s';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	context.subscriptions.push(tracker.onTick(({ seconds, state }) => {
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;

		let stateText = 'timing';
		let color = '#00FF00'; // green
		if (state === 'paused-unfocused') {
			stateText = 'paused · background';
			color = '#FFA500'; // orange
		} else if (state === 'paused-inactive') {
			stateText = 'paused · idle';
			color = '#FFA500'; // orange
		}

		statusBarItem.text = `$(primitive-dot) Rovas: ${minutes}m ${remainingSeconds}s (${stateText})`;
		statusBarItem.color = color;
	}));

	// Show tracked time command
	const showTimeDisposable = vscode.commands.registerCommand('rovas-connector.showTrackedTime', () => {
		const seconds = tracker.getTrackedSeconds();
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		const trackedMsgPromise = vscode.window.showInformationMessage(`Tracked time: ${minutes}m ${remainingSeconds}s`);
		setTimeout(() => {
			trackedMsgPromise.then(() => {});
			vscode.commands.executeCommand('workbench.action.closeMessages');
		}, 3000);
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

	// Command to manage saved projects
	const manageProjectIdsDisposable = vscode.commands.registerCommand('rovas-connector.manageProjectIds', async () => {
		const saved = getSavedProjects(context);
		if (saved.length === 0) {
			vscode.window.showInformationMessage('No saved projects to manage.');
			return;
		}
		const items = saved.map((project) => ({
			label: formatProjectLabel(project),
			description: 'Remove',
			projectId: project.id
		}));
		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select projects to remove',
			canPickMany: true,
			ignoreFocusOut: true
		});
		if (selected && selected.length > 0) {
			for (const item of selected) {
				await removeSavedProject(context, item.projectId);
			}
			vscode.window.showInformationMessage('Selected projects removed.');
		}
	});
	context.subscriptions.push(manageProjectIdsDisposable);

	// After each git commit, show a modal asking whether to create a Rovas work report
	registerCommitWorkReportPrompt(context, tracker);
}

// This method is called when your extension is deactivated
export function deactivate() {}
