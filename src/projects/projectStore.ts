// Saved Rovas projects (id + title) for settings and work-report picker

import * as vscode from 'vscode';

export interface SavedProject {
	id: string;
	title: string;
}

const STORAGE_KEY = 'savedProjects';
const LEGACY_KEY = 'projectIdHistory';

export function getSavedProjects(context: vscode.ExtensionContext): SavedProject[] {
	const stored = context.globalState.get<SavedProject[] | string[]>(STORAGE_KEY);
	if (Array.isArray(stored) && stored.length > 0) {
		if (typeof stored[0] === 'string') {
			// Unlikely path: STORAGE_KEY held legacy strings
			return (stored as string[]).map((id) => ({ id, title: '' }));
		}
		return normalize(stored as SavedProject[]);
	}

	const legacy = context.globalState.get<string[]>(LEGACY_KEY, []);
	if (legacy.length > 0) {
		const migrated = legacy.map((id) => ({ id: String(id), title: '' }));
		void context.globalState.update(STORAGE_KEY, migrated);
		return migrated;
	}

	return [];
}

export async function setSavedProjects(
	context: vscode.ExtensionContext,
	projects: SavedProject[]
): Promise<void> {
	const normalized = normalize(projects);
	await context.globalState.update(STORAGE_KEY, normalized);
	// Keep legacy key in sync for any leftover readers
	await context.globalState.update(
		LEGACY_KEY,
		normalized.map((p) => p.id)
	);
}

export async function upsertSavedProject(
	context: vscode.ExtensionContext,
	project: SavedProject
): Promise<SavedProject[]> {
	const id = String(project.id || '').trim();
	if (!id) {
		return getSavedProjects(context);
	}
	const title = (project.title || '').trim();
	const existing = getSavedProjects(context);
	const idx = existing.findIndex((p) => p.id === id);
	let next: SavedProject[];
	if (idx >= 0) {
		next = [...existing];
		next[idx] = {
			id,
			title: title || existing[idx].title
		};
	} else {
		next = [...existing, { id, title }];
	}
	await setSavedProjects(context, next);
	return next;
}

export async function removeSavedProject(
	context: vscode.ExtensionContext,
	projectId: string
): Promise<SavedProject[]> {
	const next = getSavedProjects(context).filter((p) => p.id !== projectId);
	await setSavedProjects(context, next);
	return next;
}

export function formatProjectLabel(project: SavedProject): string {
	if (project.title) {
		return `${project.title} (#${project.id})`;
	}
	return `#${project.id}`;
}

export function findSavedProject(
	projects: SavedProject[],
	projectId: string
): SavedProject | undefined {
	return projects.find((p) => p.id === projectId);
}

function normalize(projects: SavedProject[]): SavedProject[] {
	const seen = new Set<string>();
	const out: SavedProject[] = [];
	for (const p of projects) {
		const id = String(p?.id || '').trim();
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		out.push({ id, title: String(p?.title || '').trim() });
	}
	return out;
}
