// timeTracker.ts
// Core logic for tracking active editing time in VS Code / Cursor

import * as vscode from 'vscode';
import { getSystemIdleSeconds } from './systemIdle';

export type TrackingState = 'timing' | 'paused-unfocused' | 'paused-inactive';

export type TickListener = (info: { seconds: number; state: TrackingState }) => void;

export class TimeTracker {
  private trackedSeconds: number = 0;
  private lastActivity: number = Date.now();
  private inactivityTolerance: number = 30; // seconds
  private timer: NodeJS.Timeout | undefined;
  private disposables: vscode.Disposable[] = [];
  /** Last state decided by the tick — single source of truth for UI + counting */
  private currentState: TrackingState = 'timing';
  private tickListeners: TickListener[] = [];
  /** Cached: whether OS idle detection works on this machine */
  private systemIdleAvailable: boolean | null = null;

  constructor(private context: vscode.ExtensionContext) {}

  public async loadState() {
    const stored = await this.context.globalState.get<number>('trackedSeconds', 0);
    this.trackedSeconds = stored;
  }

  public async setTrackedSeconds(seconds: number) {
    this.trackedSeconds = seconds;
    await this.saveState();
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

    // Prefer OS input-idle: covers Cursor Chat/Agent typing (webview keystrokes
    // never reach the VS Code extension API).
    const systemIdle = getSystemIdleSeconds();
    if (systemIdle !== null) {
      this.systemIdleAvailable = true;
      if (systemIdle >= this.inactivityTolerance) {
        return 'paused-inactive';
      }
      return 'timing';
    }

    this.systemIdleAvailable = false;
    // Fallback: editor-only activity (Chat typing will look idle)
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

  public usesSystemIdleDetection(): boolean {
    if (this.systemIdleAvailable === null) {
      this.systemIdleAvailable = getSystemIdleSeconds() !== null;
    }
    return this.systemIdleAvailable;
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
}
