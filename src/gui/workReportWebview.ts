// workReportWebview.ts
// Confirm work report creation with project dropdown (saved projects)

import * as vscode from 'vscode';
import {
	SavedProject,
	formatProjectLabel,
	getSavedProjects,
	upsertSavedProject
} from '../projects/projectStore';
import { fetchNode } from '../rovasApi/client';

export interface WorkReportPromptInput {
	shortHash: string;
	commitMessage: string;
	trackedLabel: string;
	defaultProjectId: string;
	apiKey: string;
	apiToken: string;
	/** Folder / repo path where the commit happened (useful with multi-root workspaces) */
	repoLabel?: string;
}

export interface WorkReportPromptResult {
	projectId: string;
	projectTitle: string;
}

export function showWorkReportPrompt(
	context: vscode.ExtensionContext,
	input: WorkReportPromptInput
): Promise<WorkReportPromptResult | undefined> {
	return new Promise((resolve) => {
		const projects = [...getSavedProjects(context)];
		const defaultId =
			input.defaultProjectId ||
			(projects[0] ? projects[0].id : '');

		// Ensure the configured default appears in the dropdown even before titles are fetched
		if (defaultId && !projects.some((p) => p.id === defaultId)) {
			projects.unshift({ id: defaultId, title: '' });
		}

		const panel = vscode.window.createWebviewPanel(
			'rovasWorkReport',
			'Create Rovas work report',
			vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: false }
		);

		let settled = false;
		const finish = (value: WorkReportPromptResult | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(value);
			panel.dispose();
		};

		panel.onDidDispose(() => finish(undefined));

		panel.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'cancel') {
				finish(undefined);
				return;
			}
			if (message.command === 'create') {
				let projectId = String(message.projectId || '').trim();
				let projectTitle = String(message.projectTitle || '').trim();

				if (message.mode === 'new') {
					const entered = String(message.newProjectId || '').trim();
					if (!entered) {
						panel.webview.postMessage({
							command: 'error',
							message: 'Enter a Project ID.'
						});
						return;
					}
					projectId = entered;
					try {
						const node = await fetchNode(projectId, input.apiKey, input.apiToken);
						projectTitle = node.title || '';
						await upsertSavedProject(context, { id: projectId, title: projectTitle });
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						panel.webview.postMessage({
							command: 'error',
							message: msg
						});
						return;
					}
				} else if (!projectTitle && projectId) {
					const known = projects.find((p) => p.id === projectId);
					projectTitle = known?.title || '';
				}

				if (!projectId) {
					panel.webview.postMessage({
						command: 'error',
						message: 'Select a project.'
					});
					return;
				}

				finish({ projectId, projectTitle });
			}
		});

		panel.webview.html = getWebviewContent(input, projects, defaultId);
	});
}

function getWebviewContent(
	input: WorkReportPromptInput,
	projects: SavedProject[],
	defaultId: string
): string {
	const options = projects
		.map((p) => {
			const selected = p.id === defaultId ? ' selected' : '';
			const label = escapeHtml(formatProjectLabel(p));
			return `<option value="${escapeHtml(p.id)}" data-title="${escapeHtml(p.title)}"${selected}>${label}</option>`;
		})
		.join('');

	const defaultProject = projects.find((p) => p.id === defaultId);
	const initialSummary = defaultProject
		? formatProjectLabel(defaultProject)
		: defaultId
			? `#${defaultId}`
			: 'No project selected';

	const hasProjects = projects.length > 0;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Create Rovas work report</title>
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
		.wrap { max-width: 520px; }
		h1 { font-size: 1.25rem; margin: 0 0 8px; font-weight: 600; }
		.meta { color: var(--vscode-descriptionForeground); margin: 0 0 20px; }
		.card {
			padding: 12px 14px;
			margin-bottom: 16px;
			background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.12));
			border-left: 3px solid var(--vscode-textLink-foreground, #3794ff);
		}
		.card strong { display: block; margin-bottom: 4px; }
		label { display: block; font-weight: 500; margin-bottom: 6px; }
		select, input[type="text"] {
			width: 100%;
			box-sizing: border-box;
			padding: 8px 10px;
			border: 1px solid var(--vscode-input-border, transparent);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border-radius: 2px;
			margin-bottom: 10px;
		}
		.hint { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 0 0 12px; }
		.selected {
			font-size: 1.05rem;
			margin: 8px 0 16px;
		}
		.actions { display: flex; gap: 10px; margin-top: 8px; }
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
		.error {
			display: none;
			margin-top: 12px;
			padding: 8px 10px;
			border-left: 3px solid #f85149;
			background: color-mix(in srgb, #f85149 18%, transparent);
		}
		.error.visible { display: block; }
		.fee { margin-top: 16px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
		#newProjectWrap { display: none; }
		#newProjectWrap.visible { display: block; }
	</style>
</head>
<body>
	<div class="wrap">
		<h1>Create Rovas work report?</h1>
		<p class="meta">Commit <code>${escapeHtml(input.shortHash)}</code>${
			input.commitMessage ? ` — “${escapeHtml(input.commitMessage)}”` : ''
		}${
			input.repoLabel ? `<br>Repository: <code>${escapeHtml(input.repoLabel)}</code>` : ''
		}</p>

		<div class="card">
			<strong>Tracked time</strong>
			${escapeHtml(input.trackedLabel)}
		</div>

		<label for="projectSelect">Rovas project</label>
		<select id="projectSelect">
			${hasProjects ? options : '<option value="">No saved projects</option>'}
			<option value="__new__">Enter a different Project ID…</option>
		</select>
		<p class="hint">Pick which saved project this report should go to. The default from settings is pre-selected.</p>

		<div id="newProjectWrap">
			<label for="newProjectId">New Project ID</label>
			<input type="text" id="newProjectId" placeholder="e.g. 570178" />
		</div>

		<p class="selected">Report will be created under:<br><strong id="selectedLabel">${escapeHtml(initialSummary)}</strong></p>

		<div class="actions">
			<button type="button" class="primary" id="createBtn">Create work report</button>
			<button type="button" class="secondary" id="skipBtn">Skip</button>
		</div>
		<div id="error" class="error"></div>
		<p class="fee">A 3% usage fee applies to each report.</p>
	</div>
	<script>
		const vscode = acquireVsCodeApi();
		const select = document.getElementById('projectSelect');
		const newWrap = document.getElementById('newProjectWrap');
		const newInput = document.getElementById('newProjectId');
		const selectedLabel = document.getElementById('selectedLabel');
		const errorEl = document.getElementById('error');

		function currentTitle() {
			const opt = select.options[select.selectedIndex];
			return opt ? (opt.getAttribute('data-title') || '') : '';
		}

		function updateLabel() {
			errorEl.classList.remove('visible');
			if (select.value === '__new__') {
				newWrap.classList.add('visible');
				const id = newInput.value.trim();
				selectedLabel.textContent = id ? ('#' + id + ' (will look up title)') : 'Enter a Project ID';
				return;
			}
			newWrap.classList.remove('visible');
			const opt = select.options[select.selectedIndex];
			selectedLabel.textContent = opt ? opt.textContent : 'No project selected';
		}

		select.addEventListener('change', updateLabel);
		newInput.addEventListener('input', updateLabel);

		document.getElementById('skipBtn').addEventListener('click', () => {
			vscode.postMessage({ command: 'cancel' });
		});

		document.getElementById('createBtn').addEventListener('click', () => {
			errorEl.classList.remove('visible');
			if (select.value === '__new__') {
				vscode.postMessage({
					command: 'create',
					mode: 'new',
					newProjectId: newInput.value
				});
				return;
			}
			vscode.postMessage({
				command: 'create',
				mode: 'saved',
				projectId: select.value,
				projectTitle: currentTitle()
			});
		});

		window.addEventListener('message', (event) => {
			const msg = event.data;
			if (msg && msg.command === 'error') {
				errorEl.textContent = msg.message || 'Something went wrong';
				errorEl.classList.add('visible');
			}
		});

		updateLabel();
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
