// settingsWebview.ts
// User-friendly settings panel for Rovas Connector

import * as vscode from 'vscode';

interface SettingsSnapshot {
	hasApiKey: boolean;
	hasApiToken: boolean;
	projectId: string;
	projectIdHistory: string[];
	inactivityTimeout: number;
	paidStatus: boolean;
}

let currentPanel: vscode.WebviewPanel | undefined;

export async function showSettingsWebview(context: vscode.ExtensionContext) {
	if (currentPanel) {
		currentPanel.reveal(vscode.ViewColumn.One);
		await refreshPanel(context, currentPanel);
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'rovasSettings',
		'Rovas Connector Settings',
		vscode.ViewColumn.One,
		{ enableScripts: true, retainContextWhenHidden: true }
	);
	currentPanel = panel;

	panel.onDidDispose(() => {
		currentPanel = undefined;
	});

	panel.webview.onDidReceiveMessage(async (message) => {
		try {
			switch (message.command) {
				case 'save':
					await saveSettings(context, message);
					vscode.window.showInformationMessage('Rovas Connector settings saved.');
					await refreshPanel(context, panel);
					break;
				case 'clearApiKey':
					await context.secrets.delete('rovas-connector.apiKey');
					vscode.window.showInformationMessage('API Key cleared.');
					await refreshPanel(context, panel);
					break;
				case 'clearApiToken':
					await context.secrets.delete('rovas-connector.apiToken');
					vscode.window.showInformationMessage('API Token cleared.');
					await refreshPanel(context, panel);
					break;
				case 'removeProjectId':
					await removeProjectIdFromHistory(context, message.projectId);
					await refreshPanel(context, panel);
					break;
				case 'cancel':
					panel.dispose();
					break;
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to update settings: ${msg}`);
		}
	});

	await refreshPanel(context, panel);
}

async function refreshPanel(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
	const snapshot = await getSettingsSnapshot(context);
	panel.webview.html = getWebviewContent(snapshot);
}

async function getSettingsSnapshot(context: vscode.ExtensionContext): Promise<SettingsSnapshot> {
	const config = vscode.workspace.getConfiguration('rovas-connector');
	const apiKey = await context.secrets.get('rovas-connector.apiKey');
	const apiToken = await context.secrets.get('rovas-connector.apiToken');

	return {
		hasApiKey: Boolean(apiKey),
		hasApiToken: Boolean(apiToken),
		projectId: config.get<string>('projectId', ''),
		projectIdHistory: context.globalState.get<string[]>('projectIdHistory', []),
		inactivityTimeout: config.get<number>('inactivityTimeout', 30),
		paidStatus: config.get<boolean>('paidStatus', false)
	};
}

async function saveSettings(
	context: vscode.ExtensionContext,
	message: {
		apiKey?: string;
		apiToken?: string;
		projectId: string;
		inactivityTimeout: number;
		paidStatus: boolean;
	}
) {
	const config = vscode.workspace.getConfiguration('rovas-connector');
	const projectId = (message.projectId || '').trim();
	const inactivityTimeout = Math.max(5, Number(message.inactivityTimeout) || 30);

	if (message.apiKey && message.apiKey.trim()) {
		await context.secrets.store('rovas-connector.apiKey', message.apiKey.trim());
	}
	if (message.apiToken && message.apiToken.trim()) {
		await context.secrets.store('rovas-connector.apiToken', message.apiToken.trim());
	}

	await config.update('projectId', projectId, vscode.ConfigurationTarget.Global);
	await config.update('inactivityTimeout', inactivityTimeout, vscode.ConfigurationTarget.Global);
	await config.update('paidStatus', Boolean(message.paidStatus), vscode.ConfigurationTarget.Global);

	if (projectId) {
		const history = context.globalState.get<string[]>('projectIdHistory', []);
		if (!history.includes(projectId)) {
			await context.globalState.update('projectIdHistory', [...history, projectId]);
		}
	}
}

async function removeProjectIdFromHistory(context: vscode.ExtensionContext, projectId: string) {
	const history = context.globalState.get<string[]>('projectIdHistory', []);
	await context.globalState.update(
		'projectIdHistory',
		history.filter((id) => id !== projectId)
	);
}

function getWebviewContent(settings: SettingsSnapshot): string {
	const historyHtml = settings.projectIdHistory.length
		? settings.projectIdHistory
				.map(
					(id) => `
			<li class="history-item">
				<span>${escapeHtml(id)}${id === settings.projectId ? ' <em>(default)</em>' : ''}</span>
				<button type="button" class="link-btn" data-remove="${escapeHtml(id)}">Remove</button>
			</li>`
				)
				.join('')
		: '<li class="muted">No saved Project IDs yet.</li>';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Rovas Connector Settings</title>
	<style>
		:root {
			color-scheme: light dark;
		}
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			margin: 0;
			padding: 24px;
			line-height: 1.45;
		}
		.wrap {
			max-width: 640px;
		}
		h1 {
			font-size: 1.4rem;
			font-weight: 600;
			margin: 0 0 6px;
		}
		.subtitle {
			color: var(--vscode-descriptionForeground);
			margin: 0 0 24px;
		}
		section {
			margin-bottom: 28px;
			padding-bottom: 20px;
			border-bottom: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.3));
		}
		section:last-of-type {
			border-bottom: none;
		}
		h2 {
			font-size: 1rem;
			font-weight: 600;
			margin: 0 0 12px;
		}
		.field {
			margin-bottom: 14px;
		}
		label {
			display: block;
			margin-bottom: 6px;
			font-weight: 500;
		}
		.hint {
			display: block;
			margin-top: 4px;
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
		}
		input[type="text"],
		input[type="password"],
		input[type="number"] {
			width: 100%;
			box-sizing: border-box;
			padding: 8px 10px;
			border: 1px solid var(--vscode-input-border, transparent);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border-radius: 2px;
		}
		input:focus {
			outline: 1px solid var(--vscode-focusBorder);
		}
		.row {
			display: flex;
			gap: 8px;
			align-items: center;
		}
		.row input {
			flex: 1;
		}
		.status {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			margin-bottom: 8px;
			font-size: 0.92em;
		}
		.dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			display: inline-block;
		}
		.dot.ok { background: #3fb950; }
		.dot.missing { background: #d29922; }
		.checkbox-row {
			display: flex;
			gap: 10px;
			align-items: flex-start;
		}
		.checkbox-row input {
			margin-top: 3px;
		}
		.fee-note {
			background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.12));
			border-left: 3px solid var(--vscode-textLink-foreground, #3794ff);
			padding: 10px 12px;
			margin-top: 8px;
		}
		.actions {
			display: flex;
			gap: 10px;
			margin-top: 8px;
		}
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
		.primary:hover {
			background: var(--vscode-button-hoverBackground);
		}
		.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		.link-btn {
			background: transparent;
			color: var(--vscode-textLink-foreground);
			padding: 0;
			text-decoration: underline;
		}
		.history-list {
			list-style: none;
			padding: 0;
			margin: 0;
		}
		.history-item {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 6px 0;
			border-bottom: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.2));
		}
		.muted {
			color: var(--vscode-descriptionForeground);
		}
		em {
			font-style: normal;
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
		}
	</style>
</head>
<body>
	<div class="wrap">
		<h1>Rovas Connector Settings</h1>
		<p class="subtitle">Configure credentials, project defaults, and tracking preferences.</p>

		<form id="settingsForm">
			<section>
				<h2>API credentials</h2>
				<p class="status">
					<span class="dot ${settings.hasApiKey ? 'ok' : 'missing'}"></span>
					API Key: ${settings.hasApiKey ? 'saved securely' : 'not set'}
				</p>
				<div class="field">
					<label for="apiKey">${settings.hasApiKey ? 'Replace API Key' : 'API Key'}</label>
					<div class="row">
						<input type="password" id="apiKey" placeholder="${settings.hasApiKey ? '••••••••  (leave blank to keep)' : 'Enter API Key'}" autocomplete="off" />
						${settings.hasApiKey ? '<button type="button" class="secondary" id="clearApiKey">Clear</button>' : ''}
					</div>
				</div>
				<p class="status">
					<span class="dot ${settings.hasApiToken ? 'ok' : 'missing'}"></span>
					API Token: ${settings.hasApiToken ? 'saved securely' : 'not set'}
				</p>
				<div class="field">
					<label for="apiToken">${settings.hasApiToken ? 'Replace API Token' : 'API Token'}</label>
					<div class="row">
						<input type="password" id="apiToken" placeholder="${settings.hasApiToken ? '••••••••  (leave blank to keep)' : 'Enter API Token'}" autocomplete="off" />
						${settings.hasApiToken ? '<button type="button" class="secondary" id="clearApiToken">Clear</button>' : ''}
					</div>
				</div>
			</section>

			<section>
				<h2>Project</h2>
				<div class="field">
					<label for="projectId">Default Project ID</label>
					<input type="text" id="projectId" value="${escapeHtml(settings.projectId)}" placeholder="Rovas parent project ID" />
					<span class="hint">Used as the default when creating work reports after a commit.</span>
				</div>
				<div class="field">
					<label>Saved Project IDs</label>
					<ul class="history-list">${historyHtml}</ul>
				</div>
			</section>

			<section>
				<h2>Time tracking</h2>
				<div class="field">
					<label for="inactivityTimeout">Inactivity timeout (seconds)</label>
					<input type="number" id="inactivityTimeout" min="5" value="${settings.inactivityTimeout}" />
					<span class="hint">Seconds after the last activity before tracking pauses. Activity = typing, clicking/selecting, scrolling, or switching editors — not mouse movement alone. Tracking also pauses when Cursor is in the background. Minimum 5.</span>
				</div>
			</section>

			<section>
				<h2>Work reports</h2>
				<div class="field checkbox-row">
					<input type="checkbox" id="paidStatus" ${settings.paidStatus ? 'checked' : ''} />
					<label for="paidStatus" style="margin:0;font-weight:400">
						I am <strong>not</strong> paid by a company for this programming work
						<span class="hint">Required before the extension prompts you to send a work report.</span>
					</label>
				</div>
				<div class="fee-note">
					A 3% usage fee is charged on every report sent. Fee Chrons are converted to Merits for the Rovas Connector for Code project.
				</div>
			</section>

			<div class="actions">
				<button type="submit" class="primary">Save settings</button>
				<button type="button" class="secondary" id="cancelBtn">Close</button>
			</div>
		</form>
	</div>

	<script>
		const vscode = acquireVsCodeApi();
		const form = document.getElementById('settingsForm');

		form.addEventListener('submit', (e) => {
			e.preventDefault();
			vscode.postMessage({
				command: 'save',
				apiKey: document.getElementById('apiKey').value,
				apiToken: document.getElementById('apiToken').value,
				projectId: document.getElementById('projectId').value,
				inactivityTimeout: parseInt(document.getElementById('inactivityTimeout').value, 10) || 30,
				paidStatus: document.getElementById('paidStatus').checked
			});
		});

		document.getElementById('cancelBtn').addEventListener('click', () => {
			vscode.postMessage({ command: 'cancel' });
		});

		const clearKey = document.getElementById('clearApiKey');
		if (clearKey) {
			clearKey.addEventListener('click', () => vscode.postMessage({ command: 'clearApiKey' }));
		}
		const clearToken = document.getElementById('clearApiToken');
		if (clearToken) {
			clearToken.addEventListener('click', () => vscode.postMessage({ command: 'clearApiToken' }));
		}

		document.querySelectorAll('[data-remove]').forEach((btn) => {
			btn.addEventListener('click', () => {
				vscode.postMessage({ command: 'removeProjectId', projectId: btn.getAttribute('data-remove') });
			});
		});
	</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
