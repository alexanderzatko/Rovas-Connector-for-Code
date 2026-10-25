// timeTracker.ts
// Core logic for tracking active editing time in VS Code

import * as vscode from 'vscode';

export type TrackingState = 'timing' | 'paused-unfocused' | 'paused-inactive';

export type TickListener = (info: { seconds: number; state: TrackingState }) => void;

export class TimeTracker {
  private trackedSeconds: number = 0;
  private lastActivity: number = Date.now();
  private inactivityTolerance: number = 60; // seconds, configurable
  private timer: NodeJS.Timeout | undefined;
  private disposables: vscode.Disposable[] = [];
  /** Last state decided by the 1s tick — single source of truth for UI + counting */
  private currentState: TrackingState = 'timing';
  private tickListeners: TickListener[] = [];

  constructor(private context: vscode.ExtensionContext) {}

  public async loadState() {
    const stored = await this.context.globalState.get<number>('trackedSeconds', 0);
    this.trackedSeconds = stored;
  }

  public async setTrackedSeconds(seconds: number) {
    this.trackedSeconds = seconds;
    await this.saveState();
    this.emitTick();
  }

  public start() {
    this.loadState().then(() => {
      this.currentState = this.computeTrackingState();
      this.timer = setInterval(() => this.tick(), 1000);
      this.registerListeners();
      this.emitTick();
    });
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  public reset() {
    this.trackedSeconds = 0;
    this.saveState();
    this.emitTick();
  }

  /** Status bar (and others) should subscribe here instead of using a separate interval. */
  public onTick(listener: TickListener): vscode.Disposable {
    this.tickListeners.push(listener);
    return {
      dispose: () => {
        this.tickListeners = this.tickListeners.filter((l) => l !== listener);
      }
    };
  }

  private registerListeners() {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(() => this.recordActivity()),
      vscode.window.onDidChangeActiveTextEditor(() => this.recordActivity()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.recordActivity()),
      vscode.window.onDidChangeTextEditorSelection(() => this.recordActivity()),
      // Scrolling / revealing code counts as activity (mouse move alone does not — no VS Code API for it)
      vscode.window.onDidChangeTextEditorVisibleRanges(() => this.recordActivity()),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.recordActivity();
        } else {
          // Pause UI immediately when the window goes to the background
          this.refreshState(false);
        }
      })
    );

    if (vscode.window.onDidChangeActiveTerminal) {
      this.disposables.push(vscode.window.onDidChangeActiveTerminal(() => this.recordActivity()));
    }
    if (vscode.window.onDidChangeVisibleNotebookEditors) {
      this.disposables.push(vscode.window.onDidChangeVisibleNotebookEditors(() => this.recordActivity()));
    }
  }

  private recordActivity() {
    if (!vscode.window.state.focused) {
      return;
    }
    this.lastActivity = Date.now();
    // Update status immediately (e.g. click resumes) without adding an extra second
    this.refreshState(false);
  }

  private tick() {
    this.refreshState(true);
  }

  /** Decide pause/timing once; only the 1s timer passes increment=true. */
  private refreshState(increment: boolean) {
    this.currentState = this.computeTrackingState();
    if (increment && this.currentState === 'timing') {
      this.trackedSeconds++;
      this.saveState();
    }
    this.emitTick();
  }

  private computeTrackingState(): TrackingState {
    if (!vscode.window.state.focused) {
      return 'paused-unfocused';
    }
    const idleSeconds = (Date.now() - this.lastActivity) / 1000;
    if (idleSeconds >= this.inactivityTolerance) {
      return 'paused-inactive';
    }
    return 'timing';
  }

  private emitTick() {
    const info = { seconds: this.trackedSeconds, state: this.currentState };
    for (const listener of this.tickListeners) {
      listener(info);
    }
  }

  public getTrackingState(): TrackingState {
    return this.currentState;
  }

  public isActivelyTracking(): boolean {
    return this.currentState === 'timing';
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
