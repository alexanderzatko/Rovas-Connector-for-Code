// Per-repository storage for commits skipped at the work-report prompt.
// Keyed by git repo root so multi-root / multi-project workspaces stay separate.

import * as path from 'path';
import * as vscode from 'vscode';

export interface DeferredCommit {
	hash: string;
	message: string;
	skippedAt: number;
}

const STORAGE_KEY = 'deferredCommitsByRepo';
const MAX_PER_REPO = 50;

type DeferredMap = Record<string, DeferredCommit[]>;

/** Stable key for comparing/storing repo roots across platforms. */
export function normalizeRepoRoot(repoRoot: string): string {
	const trimmed = String(repoRoot || '').trim();
	if (!trimmed || trimmed === '(unknown repo)') {
		return trimmed;
	}
	const resolved = path.resolve(trimmed);
	// macOS/Windows often treat paths as case-insensitive
	return process.platform === 'win32' || process.platform === 'darwin'
		? resolved.toLowerCase()
		: resolved;
}

export function repoRootsEqual(a: string, b: string): boolean {
	const na = normalizeRepoRoot(a);
	const nb = normalizeRepoRoot(b);
	return Boolean(na) && na === nb;
}

/** True if fileOrDir is the same as root or lives under it. */
export function isPathInsideRepo(fileOrDir: string, repoRoot: string): boolean {
	const file = normalizeRepoRoot(fileOrDir);
	const root = normalizeRepoRoot(repoRoot);
	if (!file || !root) {
		return false;
	}
	if (file === root) {
		return true;
	}
	const prefix = root.endsWith(path.sep) ? root : root + path.sep;
	return file.startsWith(prefix);
}

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

function findMapKey(map: DeferredMap, repoRoot: string): string | undefined {
	const target = normalizeRepoRoot(repoRoot);
	if (!target) {
		return undefined;
	}
	if (Object.prototype.hasOwnProperty.call(map, repoRoot)) {
		return repoRoot;
	}
	return Object.keys(map).find((key) => normalizeRepoRoot(key) === target);
}

function normalizeCommitList(list: unknown): DeferredCommit[] {
	if (!Array.isArray(list)) {
		return [];
	}
	return list
		.filter((c) => c && typeof (c as DeferredCommit).hash === 'string' && (c as DeferredCommit).hash.trim())
		.map((c) => {
			const commit = c as DeferredCommit;
			return {
				hash: commit.hash.trim(),
				message: String(commit.message || '').trim(),
				skippedAt: typeof commit.skippedAt === 'number' ? commit.skippedAt : 0
			};
		});
}

export function getDeferredCommits(
	context: vscode.ExtensionContext,
	repoRoot: string
): DeferredCommit[] {
	const map = readMap(context);
	const key = findMapKey(map, repoRoot);
	if (!key) {
		return [];
	}
	return normalizeCommitList(map[key]);
}

export interface DeferredRepoCommits {
	repoRoot: string;
	commits: DeferredCommit[];
}

/** All repositories that currently have skipped commits pending a report. */
export function listDeferredByRepo(context: vscode.ExtensionContext): DeferredRepoCommits[] {
	const map = readMap(context);
	const out: DeferredRepoCommits[] = [];
	for (const repoRoot of Object.keys(map)) {
		const commits = normalizeCommitList(map[repoRoot]);
		if (commits.length > 0) {
			out.push({ repoRoot, commits });
		}
	}
	return out.sort((a, b) => a.repoRoot.localeCompare(b.repoRoot));
}

/**
 * Deferred commits whose repo roots match any of the given open workspace/git roots.
 */
export function listDeferredForRoots(
	context: vscode.ExtensionContext,
	openRoots: string[]
): DeferredRepoCommits[] {
	if (openRoots.length === 0) {
		return [];
	}
	return listDeferredByRepo(context).filter((entry) =>
		openRoots.some(
			(root) =>
				repoRootsEqual(root, entry.repoRoot) ||
				isPathInsideRepo(entry.repoRoot, root) ||
				isPathInsideRepo(root, entry.repoRoot)
		)
	);
}

export async function addDeferredCommit(
	context: vscode.ExtensionContext,
	repoRoot: string,
	commit: { hash: string; message?: string }
): Promise<DeferredCommit[]> {
	const hash = String(commit.hash || '').trim();
	const canonicalRoot = String(repoRoot || '').trim();
	if (!canonicalRoot || !hash) {
		return getDeferredCommits(context, canonicalRoot);
	}

	const map = readMap(context);
	const existingKey = findMapKey(map, canonicalRoot);
	const storageKey = existingKey || canonicalRoot;
	const existing = normalizeCommitList(map[storageKey]);
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

	// Prefer the live fsPath as the canonical key; drop any alias key
	if (existingKey && existingKey !== canonicalRoot) {
		delete map[existingKey];
	}
	map[canonicalRoot] = next;
	await writeMap(context, map);
	return next;
}

export async function clearDeferredCommits(
	context: vscode.ExtensionContext,
	repoRoot: string
): Promise<void> {
	const map = readMap(context);
	const key = findMapKey(map, repoRoot);
	if (!key) {
		return;
	}
	delete map[key];
	await writeMap(context, map);
}

export function shortHash(hash: string): string {
	return hash.slice(0, 7);
}
