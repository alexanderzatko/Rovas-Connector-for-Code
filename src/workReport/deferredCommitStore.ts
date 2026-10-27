// Per-repository storage for commits skipped at the work-report prompt.
// Keyed by git repo root so multi-root / multi-project workspaces stay separate.

import * as vscode from 'vscode';

export interface DeferredCommit {
	hash: string;
	message: string;
	skippedAt: number;
}

const STORAGE_KEY = 'deferredCommitsByRepo';
const MAX_PER_REPO = 50;

type DeferredMap = Record<string, DeferredCommit[]>;

function readMap(context: vscode.ExtensionContext): DeferredMap {
	const stored = context.globalState.get<DeferredMap>(STORAGE_KEY);
	if (!stored || typeof stored !== 'object') {
		return {};
	}
	return stored;
}

async function writeMap(context: vscode.ExtensionContext, map: DeferredMap): Promise<void> {
	await context.globalState.update(STORAGE_KEY, map);
}

export function getDeferredCommits(
	context: vscode.ExtensionContext,
	repoRoot: string
): DeferredCommit[] {
	const list = readMap(context)[repoRoot];
	if (!Array.isArray(list)) {
		return [];
	}
	return list
		.filter((c) => c && typeof c.hash === 'string' && c.hash.trim())
		.map((c) => ({
			hash: c.hash.trim(),
			message: String(c.message || '').trim(),
			skippedAt: typeof c.skippedAt === 'number' ? c.skippedAt : 0
		}));
}

export async function addDeferredCommit(
	context: vscode.ExtensionContext,
	repoRoot: string,
	commit: { hash: string; message?: string }
): Promise<DeferredCommit[]> {
	const hash = String(commit.hash || '').trim();
	if (!repoRoot || !hash) {
		return getDeferredCommits(context, repoRoot);
	}

	const map = readMap(context);
	const existing = getDeferredCommits(context, repoRoot);
	if (existing.some((c) => c.hash === hash)) {
		return existing;
	}

	const next = [
		...existing,
		{
			hash,
			message: String(commit.message || '').trim(),
			skippedAt: Date.now()
		}
	];
	// Keep oldest first; drop from the front if over the cap
	while (next.length > MAX_PER_REPO) {
		next.shift();
	}
	map[repoRoot] = next;
	await writeMap(context, map);
	return next;
}

export async function clearDeferredCommits(
	context: vscode.ExtensionContext,
	repoRoot: string
): Promise<void> {
	const map = readMap(context);
	if (!(repoRoot in map)) {
		return;
	}
	delete map[repoRoot];
	await writeMap(context, map);
}

export function shortHash(hash: string): string {
	return hash.slice(0, 7);
}
