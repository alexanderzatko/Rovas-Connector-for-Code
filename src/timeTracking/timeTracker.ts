// timeTracker.ts
// Core logic for tracking active editing time in VS Code / Cursor

import * as vscode from 'vscode';

export type TrackingState = 'timing' | 'paused-unfocused' | 'paused-inactive';

export type TickListener = (info: { seconds: number; state: TrackingState }) => void;

export class TimeTracker {
  private trackedSeconds: number = 0;
  private lastActivity: number = Date.now();
  private inactivityTolerance: number = 30; // seconds; used only if pauseWhenIdle
  private pauseWhenIdle: boolean = false;
  private timer: NodeJS.Timeout | undefined;
  private disposables: vscode.Disposable[] = [];
  /** Last state decided by the tick — single source of truth for UI + counting */
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
    // Setting time is an intentional user action — resume timing immediately
    this.bumpActivity();
  }

  public start() {
    this.loadState().then(() => {
      this.bumpActivity();
      this.timer = setInterval(() => this.tick(), 1000);
      this.registerListeners();
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
    this.bumpActivity();
  }

  /** Mark user activity and refresh status (does not add a second by itself). */
  public bumpActivity() {
    this.lastActivity = Date.now();
    this.refreshState(false);
  }

  /** Status bar (and others) should subscribe here instead of using a separate interval. */
  public onTick(listener: TickListener): vscode.Disposable {
    this.tickListeners.push(listener);
    // Push current snapshot immediately so UI is correct without waiting 1s
    listener({ seconds: this.trackedSeconds, state: this.currentState });
    return {
      dispose: () => {
        this.tickListeners = this.tickListeners.filter((l) => l !== listener);
      }
    };
  }

  private registerListeners() {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(() => this.bumpActivity()),
      vscode.window.onDidChangeActiveTextEditor(() => this.bumpActivity()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.bumpActivity()),
      vscode.window.onDidChangeTextEditorSelection(() => this.bumpActivity()),
      vscode.window.onDidChangeTextEditorVisibleRanges(() => this.bumpActivity()),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.bumpActivity();
        } else {
          this.refreshState(false);
        }
      })
    );

    if (vscode.window.onDidChangeActiveTerminal) {
      this.disposables.push(vscode.window.onDidChangeActiveTerminal(() => this.bumpActivity()));
    }
    if (vscode.window.onDidChangeVisibleNotebookEditors) {
      this.disposables.push(vscode.window.onDidChangeVisibleNotebookEditors(() => this.bumpActivity()));
    }
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
    // Optional: pause after editor-idle. Off by default — Cursor Chat / Agent
    // typing does not fire text-document events, so idle pause feels broken there.
    if (this.pauseWhenIdle) {
      const idleSeconds = (Date.now() - this.lastActivity) / 1000;
      if (idleSeconds >= this.inactivityTolerance) {
        return 'paused-inactive';
      }
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
    this.inactivityTolerance = Math.max(5, seconds);
  }

  public setPauseWhenIdle(enabled: boolean) {
    this.pauseWhenIdle = enabled;
    this.refreshState(false);
  }
}
