// adjustTimeWebview.ts
// Webview panel for adjusting or resetting tracked time

import * as vscode from 'vscode';
import { TimeTracker } from '../timeTracking/timeTracker';

export function showAdjustTimeWebview(context: vscode.ExtensionContext, tracker: TimeTracker) {
	const panel = vscode.window.createWebviewPanel(
		'adjustTime',
		'Adjust Tracked Time',
		vscode.ViewColumn.Active,
		{ enableScripts: true }
	);

	const totalSeconds = tracker.getTrackedSeconds();
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	panel.webview.html = getWebviewContent(hours, minutes, seconds);

	panel.webview.onDidReceiveMessage(async (message) => {
		if (message.command === 'setTime') {
			const h = Math.max(0, Math.floor(Number(message.hours) || 0));
			const m = Math.max(0, Math.floor(Number(message.minutes) || 0));
			const s = Math.max(0, Math.floor(Number(message.seconds) || 0));
			await tracker.setTrackedSeconds(h * 3600 + m * 60 + s);
			vscode.window.showInformationMessage(`Tracked time set to ${h}h ${m}m ${s}s.`);
			panel.dispose();
		} else if (message.command === 'reset') {
			tracker.reset();
			vscode.window.showInformationMessage('Time tracker reset.');
			panel.dispose();
		} else if (message.command === 'cancel') {
			panel.dispose();
		}
	});
}

function getWebviewContent(hours: number, minutes: number, seconds: number) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Adjust Tracked Time</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			margin: 0;
			padding: 24px;
			line-height: 1.45;
		}
		.wrap { max-width: 420px; }
		h2 { font-size: 1.25rem; margin: 0 0 8px; font-weight: 600; }
		.hint { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 0 0 16px; }
		.duration-row { display: flex; gap: 10px; margin-bottom: 16px; }
		.duration-row > div { flex: 1; }
		label { display: block; font-weight: 500; margin-bottom: 6px; }
		input[type="number"] {
			width: 100%;
			box-sizing: border-box;
			padding: 8px 10px;
			border: 1px solid var(--vscode-input-border, transparent);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border-radius: 2px;
		}
		.actions { display: flex; flex-wrap: wrap; gap: 10px; }
		button {
			font-family: inherit;
			font-size: inherit;
			padding: 7px 14px;
			border: none;
			border-radius: 2px;
			cursor: pointer;
		}
		.primary {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		.danger {
			background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
			color: var(--vscode-errorForeground, #f85149);
			border: 1px solid var(--vscode-inputValidation-errorBorder, #f85149);
		}
	</style>
</head>
<body>
	<div class="wrap">
		<h2>Adjust Tracked Time</h2>
		<p class="hint">Change the current tracked duration, or reset it to zero.</p>
		<div class="duration-row">
			<div>
				<label for="hours">Hours</label>
				<input type="number" id="hours" min="0" step="1" value="${hours}" />
			</div>
			<div>
				<label for="minutes">Minutes</label>
				<input type="number" id="minutes" min="0" step="1" value="${minutes}" />
			</div>
			<div>
				<label for="seconds">Seconds</label>
				<input type="number" id="seconds" min="0" step="1" value="${seconds}" />
			</div>
		</div>
		<div class="actions">
			<button type="button" class="primary" id="setBtn">Set Time</button>
			<button type="button" class="danger" id="resetBtn">Reset to zero</button>
			<button type="button" class="secondary" id="cancelBtn">Cancel</button>
		</div>
	</div>
	<script>
		const vscode = acquireVsCodeApi();
		document.getElementById('setBtn').addEventListener('click', () => {
			vscode.postMessage({
				command: 'setTime',
				hours: document.getElementById('hours').value,
				minutes: document.getElementById('minutes').value,
				seconds: document.getElementById('seconds').value
			});
		});
		document.getElementById('resetBtn').addEventListener('click', () => {
			vscode.postMessage({ command: 'reset' });
		});
		document.getElementById('cancelBtn').addEventListener('click', () => {
			vscode.postMessage({ command: 'cancel' });
		});
	</script>
</body>
</html>`;
}
