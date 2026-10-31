// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { TimeTracker } from './timeTracking/timeTracker';
import { resetTimerWithCommitPrompt } from './timeTracking/resetTimerFlow';
import { showAdjustTimeWebview } from './gui/adjustTimeWebview';
import { showSettingsWebview } from './gui/settingsWebview';
import { promptManualWorkReport, registerCommitWorkReportPrompt } from './workReport/commitPrompt';
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

	// Initialize time tracker (stopped until the user starts)
	const tracker = new TimeTracker(context);
	tracker.setInactivityTolerance(inactivityTimeout);
	tracker.initialize();

	// Status bar button: Settings
	const settingsButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
	settingsButton.text = '$(gear) Rovas Settings';
	settingsButton.command = 'rovas-connector.openSettings';
	settingsButton.tooltip = 'Open Rovas Connector settings';
	settingsButton.show();
	context.subscriptions.push(settingsButton);

	// Status bar button: Adjust time (includes reset)
	const adjustTimeButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	adjustTimeButton.text = '$(edit) Adjust Time';
	adjustTimeButton.command = 'rovas-connector.adjustTrackedTime';
	adjustTimeButton.tooltip = 'Adjust or reset tracked time';
	adjustTimeButton.show();
	context.subscriptions.push(adjustTimeButton);

	// Status bar button: Create report from saved commits
	const createReportButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
	createReportButton.text = '$(cloud-upload) Create Report';
	createReportButton.command = 'rovas-connector.createWorkReport';
	createReportButton.tooltip = 'Create a Rovas work report from saved (skipped) commits';
	createReportButton.show();
	context.subscriptions.push(createReportButton);

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

	// Listen for configuration changes
	vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('rovas-connector.inactivityTimeout')) {
			const newTimeout = vscode.workspace.getConfiguration('rovas-connector').get<number>('inactivityTimeout', 30);
			tracker.setInactivityTolerance(newTimeout);
		}
	});

	// Status bar item for tracked time (driven by the tracker tick — same state used for counting)
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = 'Rovas: 0m 0s (START)';
	statusBarItem.command = 'rovas-connector.startTimer';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	context.subscriptions.push(tracker.onTick(({ seconds, state, systemIdleSeconds, inactivityTolerance, usingSystemIdle }) => {
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;

		let stateText = 'timing';
		let color: string | undefined = '#00FF00'; // green
		if (state === 'stopped') {
			stateText = 'START';
			color = '#87CEEB'; // sky blue — click to begin
			statusBarItem.command = 'rovas-connector.startTimer';
		} else if (state === 'paused-unfocused') {
			stateText = 'paused · background';
			color = '#FFA500'; // orange
			statusBarItem.command = 'rovas-connector.stopTimer';
		} else if (state === 'paused-inactive') {
			stateText = 'paused · idle';
			color = '#FFA500'; // orange
			statusBarItem.command = 'rovas-connector.stopTimer';
		} else {
			statusBarItem.command = 'rovas-connector.stopTimer';
		}

		statusBarItem.text = `$(primitive-dot) Rovas: ${minutes}m ${remainingSeconds}s (${stateText})`;
		statusBarItem.color = color;

		if (state === 'stopped') {
			statusBarItem.tooltip = 'Rovas Connector\nClick to start time tracking';
			return;
		}

		const idleLabel =
			systemIdleSeconds === null
				? 'OS idle: unavailable (using editor fallback)'
				: `OS idle: ${Math.floor(systemIdleSeconds)}s / timeout ${inactivityTolerance}s`;
		statusBarItem.tooltip = `Rovas Connector\n${idleLabel}\nDetection: ${usingSystemIdle ? 'keyboard/mouse (incl. Chat)' : 'editor events only'}\nClick to stop tracking`;
	}));

	// Start / stop timer commands
	const startTimerDisposable = vscode.commands.registerCommand('rovas-connector.startTimer', () => {
		if (tracker.isRunning()) {
			return;
		}
		tracker.start();
		const timingMsg = vscode.window.showInformationMessage('Rovas Connector: Time tracking started.', { modal: false }, 'Dismiss');
		setTimeout(() => {
			timingMsg.then(() => {});
			vscode.commands.executeCommand('workbench.action.closeMessages');
		}, 2000);
	});
	context.subscriptions.push(startTimerDisposable);

	const stopTimerDisposable = vscode.commands.registerCommand('rovas-connector.stopTimer', () => {
		if (!tracker.isRunning()) {
			return;
		}
		tracker.stop();
		vscode.window.showInformationMessage('Rovas Connector: Time tracking stopped.');
	});
	context.subscriptions.push(stopTimerDisposable);

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

	// Reset timer command (also available from Adjust Time)
	const resetDisposable = vscode.commands.registerCommand('rovas-connector.resetTimer', async () => {
		await resetTimerWithCommitPrompt(context, tracker);
	});
	context.subscriptions.push(resetDisposable);

	// Manual / end-of-day work report from deferred commits
	const createReportDisposable = vscode.commands.registerCommand(
		'rovas-connector.createWorkReport',
		async () => {
			tracker.bumpActivity();
			await promptManualWorkReport(context, tracker);
		}
	);
	context.subscriptions.push(createReportDisposable);

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
