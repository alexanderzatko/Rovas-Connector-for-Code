// timeTracker.ts
// Core logic for tracking active editing time in VS Code

import * as vscode from 'vscode';

export class TimeTracker {
  private trackedSeconds: number = 0;
  private lastActivity: number = Date.now();
  private inactivityTolerance: number = 60; // seconds, configurable
  private timer: NodeJS.Timeout | undefined;

  constructor(private context: vscode.ExtensionContext) {}

  public async loadState() {
    const stored = await this.context.globalState.get<number>('trackedSeconds', 0);
    this.trackedSeconds = stored;
  }

  public async setTrackedSeconds(seconds: number) {
    this.trackedSeconds = seconds;
    await this.saveState();
  }

  public start() {
    this.loadState().then(() => {
      this.timer = setInterval(() => this.checkActivity(), 1000);
      this.registerListeners();
    });
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  public reset() {
    this.trackedSeconds = 0;
    this.saveState();
  }

  private registerListeners() {
  vscode.workspace.onDidChangeTextDocument(() => this.recordActivity());
  vscode.window.onDidChangeActiveTextEditor(() => this.recordActivity());
  vscode.window.onDidChangeWindowState(() => this.recordActivity());
  vscode.window.onDidChangeVisibleTextEditors(() => this.recordActivity());
  vscode.window.onDidChangeActiveTerminal?.(() => this.recordActivity());
  vscode.window.onDidChangeTextEditorSelection?.(() => this.recordActivity());
  vscode.window.onDidChangeVisibleNotebookEditors?.(() => this.recordActivity());
  // Add more events as needed for broader activity coverage
  }

  private recordActivity() {
    this.lastActivity = Date.now();
  }

  private checkActivity() {
    const now = Date.now();
    const windowState = vscode.window.state;
    // Count time whenever VS Code is focused, regardless of activity
    if (windowState.focused) {
      this.trackedSeconds++;
      this.saveState();
    }
  }

  private saveState() {
    this.context.globalState.update('trackedSeconds', this.trackedSeconds);
  }

  public getTrackedSeconds(): number {
    return this.trackedSeconds;
  }

  public setInactivityTolerance(seconds: number) {
    this.inactivityTolerance = seconds;
  }
}
