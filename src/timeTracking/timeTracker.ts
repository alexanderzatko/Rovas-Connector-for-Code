// timeTracker.ts
// Core logic for tracking active editing time in VS Code

import * as vscode from 'vscode';

export class TimeTracker {
  private trackedSeconds: number = 0;
  private lastActivity: number = Date.now();
  private inactivityTolerance: number = 30; // seconds, configurable
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
  }

  private recordActivity() {
    this.lastActivity = Date.now();
  }

  private checkActivity() {
    const now = Date.now();
    if ((now - this.lastActivity) / 1000 < this.inactivityTolerance) {
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
