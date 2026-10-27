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
import { DeferredCommit, shortHash } from '../workReport/deferredCommitStore';

export interface WorkReportPromptInput {
	shortHash: string;
	commitMessage: string;
	trackedSeconds: number;
	trackedLabel: string;
	defaultProjectId: string;
	apiKey: string;
	apiToken: string;
	/** Prefill for the editable work-report description */
	description: string;
	/** Folder / repo path where the commit happened (useful with multi-root workspaces) */
	repoLabel?: string;
	/** Earlier commits in this repo that were skipped and will be included (on-commit flow) */
	deferredCommits?: DeferredCommit[];
	/**
	 * onCommit: prompted after a git commit (Skip remembers the commit).
	 * manual: end-of-day report from already-saved commits (Cancel leaves them stored).
	 */
	mode?: 'onCommit' | 'manual';
}

export interface WorkReportPromptResult {
	projectId: string;
	projectTitle: string;
	/** User-confirmed (possibly overridden) duration in seconds */
	trackedSeconds: number;
	/** User-edited work report description */
	description: string;
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

				const trackedSeconds = parseDurationMessage(message);
				if (trackedSeconds === null) {
					panel.webview.postMessage({
						command: 'error',
						message: 'Enter a valid duration (hours, minutes, seconds ≥ 0).'
					});
					return;
				}

				const description = String(message.description || '').trim();
				if (!description) {
					panel.webview.postMessage({
						command: 'error',
						message: 'Enter a work report description.'
					});
					return;
				}

				finish({ projectId, projectTitle, trackedSeconds, description });
			}
		});

		panel.webview.html = getWebviewContent(input, projects, defaultId);
	});
}

function parseDurationMessage(message: {
	hours?: unknown;
	minutes?: unknown;
	seconds?: unknown;
}): number | null {
	const hours = Number(message.hours);
	const minutes = Number(message.minutes);
	const seconds = Number(message.seconds);
	if (![hours, minutes, seconds].every((n) => Number.isFinite(n) && n >= 0)) {
		return null;
	}
	const total = Math.floor(hours) * 3600 + Math.floor(minutes) * 60 + Math.floor(seconds);
	return Math.max(0, total);
}

function splitDuration(totalSeconds: number): { hours: number; minutes: number; seconds: number } {
	const safe = Math.max(0, Math.floor(totalSeconds));
	return {
		hours: Math.floor(safe / 3600),
		minutes: Math.floor((safe % 3600) / 60),
		seconds: safe % 60
	};
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
	const deferred = input.deferredCommits || [];
	const duration = splitDuration(input.trackedSeconds);
	const isManual = input.mode === 'manual';
	const dismissLabel = isManual ? 'Cancel' : 'Skip';
	const feeHint = isManual
		? 'A 3% usage fee applies to each report. Cancel leaves these commits saved for later.'
		: 'A 3% usage fee applies to each report. Skipping remembers this commit for a later combined report in this repository.';

	const commitListHtml = (commits: DeferredCommit[]) =>
		`<ul class="commit-list">
			${commits
				.map((c) => {
					const subject = (c.message || '').split('\n')[0].trim();
					return `<li><code>${escapeHtml(shortHash(c.hash))}</code>${
						subject ? ` — ${escapeHtml(subject)}` : ''
					}</li>`;
				})
				.join('')}
		</ul>`;

	const deferredBlock = isManual
		? deferred.length === 0
			? ''
			: `<div class="card">
			<strong>${deferred.length} saved commit${deferred.length === 1 ? '' : 's'}</strong>
			${commitListHtml(deferred)}
			<p class="hint" style="margin-bottom:0">These will be combined into one proof-of-work.</p>
		</div>`
		: deferred.length === 0
			? ''
			: `<div class="card">
			<strong>Also including ${deferred.length} earlier skipped commit${deferred.length === 1 ? '' : 's'}</strong>
			${commitListHtml(deferred)}
			<p class="hint" style="margin-bottom:0">These will be combined into one proof-of-work with the current commit.</p>
		</div>`;

	const metaBlock = isManual
		? `<p class="meta">${
				deferred.length === 1
					? `Report from saved commit <code>${escapeHtml(shortHash(deferred[0].hash))}</code>`
					: `Report from <strong>${deferred.length}</strong> saved commits`
			}${
				input.repoLabel ? `<br>Repository: <code>${escapeHtml(input.repoLabel)}</code>` : ''
			}</p>`
		: `<p class="meta">Commit <code>${escapeHtml(input.shortHash)}</code>${
				input.commitMessage ? ` — “${escapeHtml(input.commitMessage)}”` : ''
			}${
				input.repoLabel ? `<br>Repository: <code>${escapeHtml(input.repoLabel)}</code>` : ''
			}</p>`;

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
		.commit-list {
			margin: 8px 0 0;
			padding-left: 18px;
		}
		.commit-list li { margin-bottom: 4px; }
		label { display: block; font-weight: 500; margin-bottom: 6px; }
		select, input[type="text"], input[type="number"], textarea {
			width: 100%;
			box-sizing: border-box;
			padding: 8px 10px;
			border: 1px solid var(--vscode-input-border, transparent);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border-radius: 2px;
			margin-bottom: 10px;
		}
		textarea {
			min-height: 140px;
			resize: vertical;
			font-family: inherit;
			line-height: 1.4;
		}
		.duration-row {
			display: flex;
			gap: 10px;
			margin-bottom: 10px;
		}
		.duration-row > div { flex: 1; }
		.duration-row label { font-weight: 400; font-size: 0.9em; }
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
		${metaBlock}

		${deferredBlock}

		<label>Tracked time</label>
		<div class="duration-row">
			<div>
				<label for="hours">Hours</label>
				<input type="number" id="hours" min="0" step="1" value="${duration.hours}" />
			</div>
			<div>
				<label for="minutes">Minutes</label>
				<input type="number" id="minutes" min="0" step="1" value="${duration.minutes}" />
			</div>
			<div>
				<label for="seconds">Seconds</label>
				<input type="number" id="seconds" min="0" step="1" value="${duration.seconds}" />
			</div>
		</div>
		<p class="hint">You can override the tracked duration before submitting.</p>

		<label for="description">Description</label>
		<textarea id="description" rows="8">${escapeHtml(input.description)}</textarea>
		<p class="hint">Edit the generated description before it is sent to Rovas.</p>

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
			<button type="button" class="secondary" id="skipBtn">${escapeHtml(dismissLabel)}</button>
		</div>
		<div id="error" class="error"></div>
		<p class="fee">${escapeHtml(feeHint)}</p>
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

		function durationFields() {
			return {
				hours: document.getElementById('hours').value,
				minutes: document.getElementById('minutes').value,
				seconds: document.getElementById('seconds').value
			};
		}

		select.addEventListener('change', updateLabel);
		newInput.addEventListener('input', updateLabel);

		document.getElementById('skipBtn').addEventListener('click', () => {
			vscode.postMessage({ command: 'cancel' });
		});

		document.getElementById('createBtn').addEventListener('click', () => {
			errorEl.classList.remove('visible');
			const duration = durationFields();
			const description = document.getElementById('description').value;
			if (select.value === '__new__') {
				vscode.postMessage({
					command: 'create',
					mode: 'new',
					newProjectId: newInput.value,
					description,
					...duration
				});
				return;
			}
			vscode.postMessage({
				command: 'create',
				mode: 'saved',
				projectId: select.value,
				projectTitle: currentTitle(),
				description,
				...duration
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
