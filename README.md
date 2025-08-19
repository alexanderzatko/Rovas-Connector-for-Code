# Rovas Connector for Code

A Visual Studio Code extension for tracking programming time and reporting work to the [Rovas application](https://rovas.app).

## Features
- Securely store Rovas API credentials using VS Code SecretStorage
- Track programming activity and time spent in VS Code
- Status bar controls for adjusting and resetting tracked time
- Flexible Project ID selection and management
- Automatic work report creation on git commit

## Installation
1. Download the extension from the Marketplace or build from source.
2. Install in VS Code via the Extensions panel or using the `.vsix` file.

## Usage
- Set your Rovas API Key and Token using the command palette:
  - `Rovas Connector: Set API Key`
  - `Rovas Connector: Set API Token`
- Adjust or reset tracked time using the status bar buttons.
- Manage Project IDs with `Rovas Connector: Manage Project IDs`.
- On git commit, the extension will prompt to create a work report and select a Project ID.

## Configuration
- `rovas-connector.inactivityTimeout`: Set inactivity timeout (seconds) for time tracking.
- `rovas-connector.projectId`: Default Project ID for work reports.
- `rovas-connector.paidStatus`: Enable/disable paid status for work reports.
- **Note:** The plugin charges a 3% fee on every report sent. This fee will be subtracted from the Chron earnings the user receives for the time reported in the work report.

## Commands
- `rovas-connector.setApiKey`: Set Rovas API Key
- `rovas-connector.setApiToken`: Set Rovas API Token
- `rovas-connector.adjustTrackedTime`: Adjust tracked time
- `rovas-connector.resetTimer`: Reset tracked time
- `rovas-connector.showTrackedTime`: Show tracked time
- `rovas-connector.manageProjectIds`: Manage Project ID history

## Troubleshooting
- Ensure API credentials are set before submitting work reports.
- For issues, check the output panel and extension logs.

## Contributing
Pull requests and issues are welcome. Please follow standard TypeScript and VS Code extension development practices.

## License
GPLv3
