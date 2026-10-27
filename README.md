# Rovas Connector for Code

A Visual Studio Code extension for tracking programming time and reporting work to the [Rovas application](https://rovas.app).

## Features
- Securely store Rovas API credentials using VS Code SecretStorage
- Manual start/stop of programming time tracking (status bar shows START until you begin)
- Status bar control to adjust or reset tracked time
- Create Report action to submit saved (skipped) commits as an end-of-day work report
- Flexible Project ID selection and management
- Automatic work report creation on git commit
- Skip a report and remember that commit (per repository); later commits can combine skipped ones into one proof-of-work
- Override tracked time in the work-report dialog before submitting

## Installation
1. Download the extension from the Marketplace or build from source.
2. Install in VS Code via the Extensions panel or using the `.vsix` file.

## Usage
- Set your Rovas API Key and Token using the command palette:
  - `Rovas Connector: Set API Key`
  - `Rovas Connector: Set API Token`
- Click the status bar item when it shows `(START)`, or run `Rovas Connector: Start Timer`, to begin tracking. Click again while running (or use `Stop Timer`) to stop.
- Use **Adjust Time** to change or reset tracked time.
- Use **Create Report** to build a work report from commits you previously skipped (pick a repository if several have saved commits).
- Manage Project IDs with `Rovas Connector: Manage Project IDs`.
- On git commit, the extension will prompt to create a work report and select a Project ID.
- Choose **Skip** to keep tracking time and remember the commit for that repository. The next time you create a report in the same repo, skipped commits are combined into one proof-of-work (compare URL when possible) with combined commit messages.
- You can edit hours/minutes/seconds and the generated description in the dialog before submitting.

## Configuration
- `rovas-connector.inactivityTimeout`: Set inactivity timeout (seconds) for time tracking.
- `rovas-connector.projectId`: Default Project ID for work reports.
- `rovas-connector.paidStatus`: Enable/disable paid status for work reports.
- **Note:** The plugin charges a 3% fee on every report sent. This fee will be subtracted from the Chron earnings the user receives for the time reported in the work report.

## Commands
- `rovas-connector.setApiKey`: Set Rovas API Key
- `rovas-connector.setApiToken`: Set Rovas API Token
- `rovas-connector.startTimer`: Start time tracking
- `rovas-connector.stopTimer`: Stop time tracking
- `rovas-connector.adjustTrackedTime`: Adjust or reset tracked time
- `rovas-connector.createWorkReport`: Create a work report from saved commits
- `rovas-connector.resetTimer`: Reset tracked time
- `rovas-connector.showTrackedTime`: Show tracked time
- `rovas-connector.manageProjectIds`: Manage Project ID history

## Troubleshooting
- Ensure API credentials are set before submitting work reports.
- For issues, check the output panel and extension logs.

## Contributing
Pull requests and issues are welcome. Please follow standard TypeScript and VS Code extension development practices.

## License
MIT
