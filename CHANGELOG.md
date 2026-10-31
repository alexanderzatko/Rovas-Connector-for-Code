# Changelog

## [0.0.7]
- When resetting the timer, ask whether to delete saved (skipped) commit info for the current project only; other projects’ deferred commits are kept.

## [0.0.6]
- Create Report prefers the active workspace/git repository and no longer auto-selects saved commits from other projects.

## [0.0.5]
- Combine Adjust Time and Reset Time into one Adjust Time dialog (with reset).
- Add Create Report status bar action to submit a work report from all saved (skipped) commits for a repository.

## [0.0.4]
- Publishing metadata: publisher, MIT license, repository links, Marketplace icon.
- Manual start/stop for time tracking; status bar shows `START` until tracking begins.

## [0.0.3]
- Remember skipped commits per git repository and combine them into one work report (compare/range proof-of-work URL when possible, with all commit messages in the description).
- Allow overriding tracked time in the work-report dialog before submit.
- Allow editing the generated work report description before submit.

## [0.0.2]
- Use NACE classification term 1578 for programming work reports.
- Use the git commit message as the work report description (with extension attribution).

## [0.0.1]
- Initial release: Track programming time, manage Project IDs, securely store API credentials, auto-close dialogs, and report work to Rovas.
- Added status bar controls for time adjustment and reset.
- Automatic work report creation on git commit.
- Usage fee calculation and reporting.
- Improved dialog scoping and error handling.