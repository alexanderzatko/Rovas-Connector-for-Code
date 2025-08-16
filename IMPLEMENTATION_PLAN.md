# Rovas Connector VS Code Extension Implementation Plan

## Project Goal
Build a Visual Studio Code extension with time tracking and Rovas reporting features, modeled after the JOSM plugin described in the project overview.

## Step-by-Step Implementation Plan

### 1. Project Setup & MVP
- Scaffold the VS Code extension (done).
- Implement a basic command (e.g., “Hello World”) to verify extension activation and UI.

### 2. Time Tracking Module
- Create `src/timeTracking/` for time tracking logic.
- Use VS Code APIs to listen for file edits and workspace activity.
- Track active editing time and handle inactivity tolerance (configurable).
- Add command to manually reset timer.
- Persist tracked time and preferences using VS Code storage.

### 3. Rovas API Integration
- Create `src/rovasApi/` for API calls.
- Implement functions to connect to Rovas API, submit work reports, and handle credentials.
- Add error handling and user feedback for API operations.

### 4. Data Models & Preferences
- Create `src/model/` for user preferences, credentials, and configuration.
- Store API key, token, project ID, inactivity tolerance, etc.
- Use VS Code’s global/workspace state for persistence.

### 5. User Interface
- Create `src/gui/` for Webview panels and input validation.
- Build dialogs for credentials, preferences, and report submission.
- Add status bar item for time tracking status.
- Validate user input in forms.

### 6. Utilities
- Create `src/util/` for helpers (e.g., time conversion, property wrappers).

### 7. Documentation & Extensibility
- Document code structure and usage.
- Ensure code is modular and maintainable.

## Milestones
1. **MVP Command**: Display a modal (done).
2. **Time Tracking**: Track and display editing time.
3. **Preferences UI**: Configure inactivity tolerance and user settings.
4. **Rovas API**: Connect, authenticate, and report work.
5. **Reporting UI**: Submit reports via Webview.
6. **Status Bar**: Show time tracking status.
7. **Testing & Documentation**: Add tests and update README.

## Notes
- Use TypeScript and VS Code APIs for implementation.
- Adapt Rovas API endpoints and authentication logic from the JOSM plugin.
- Focus on extensibility and user experience in VS Code.
