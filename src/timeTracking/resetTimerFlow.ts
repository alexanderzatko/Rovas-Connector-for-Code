// Shared reset flow: zero tracked time, optionally clear deferred commits
// for the current project only.

import * as vscode from 'vscode';
import { TimeTracker } from './timeTracker';
import { getActiveRepositoryRoot } from '../workReport/commitPrompt';
import {
	clearDeferredCommits,
	listDeferredForRoots,
	repoRootsEqual
} from '../workReport/deferredCommitStore';

/**
 * Reset the time tracker. If the current project has skipped commits stored
 * for work reports, ask whether those should be deleted (other projects are
 * left untouched).
 */
export async function resetTimerWithCommitPrompt(
	context: vscode.ExtensionContext,
	tracker: TimeTracker
): Promise<void> {
	tracker.reset();

	const activeRoot = await getActiveRepositoryRoot();
	if (!activeRoot) {
		vscode.window.showInformationMessage('Time tracker reset.');
		return;
	}

	const matches = listDeferredForRoots(context, [activeRoot]);
	const current =
		matches.find((entry) => repoRootsEqual(entry.repoRoot, activeRoot)) ||
		(matches.length === 1 ? matches[0] : undefined);
	const commitCount = current?.commits.length ?? 0;
	if (!current || commitCount === 0) {
		vscode.window.showInformationMessage('Time tracker reset.');
		return;
	}

	const commitLabel =
		commitCount === 1 ? '1 saved commit' : `${commitCount} saved commits`;
	const choice = await vscode.window.showWarningMessage(
		`Time tracker reset. Also delete the ${commitLabel} for this project stored for creating a work report?`,
		{ modal: true },
		'Delete commits',
		'Keep commits'
	);

	if (choice === 'Delete commits') {
		await clearDeferredCommits(context, current.repoRoot);
		vscode.window.showInformationMessage(
			'Saved commit information for this project deleted.'
		);
	}
}
