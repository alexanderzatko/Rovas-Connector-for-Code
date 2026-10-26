// timeTracker.ts
// Core logic for tracking active editing time in VS Code / Cursor

import * as vscode from 'vscode';
import { getSystemIdleSeconds } from './systemIdle';

export type TrackingState = 'timing' | 'paused-unfocused' | 'paused-inactive';

export type TickListener = (info: {
  seconds: number;
  state: TrackingState;
  systemIdleSeconds: number | null;
  inactivityTolerance: number;
  usingSystemIdle: boolean;
}) => void;

export class TimeTracker {
  private trackedSeconds: number = 0;
  private lastActivity: number = Date.now();
  private inactivityTolerance: number = 30; // seconds
  private timer: NodeJS.Timeout | undefined;
  private disposables: vscode.Disposable[] = [];
  private currentState: TrackingState = 'timing';
  private tickListeners: TickListener[] = [];
  private usingSystemIdle = false;
  private lastSystemIdleSeconds: number | null = null;

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

  /** Mark user activity (fallback path when OS idle is unavailable). */
  public bumpActivity() {
    this.lastActivity = Date.now();
    this.refreshState(false);
  }

  public onTick(listener: TickListener): vscode.Disposable {
    this.tickListeners.push(listener);
    listener(this.snapshot());
    return {
      dispose: () => {
        this.tickListeners = this.tickListeners.filter((l) => l !== listener);
      }
    };
  }

  private registerListeners() {
    // These matter mainly when OS idle detection is unavailable.
    // Keep them as a fallback; they must not prevent idle pause when OS idle works.
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(() => this.bumpActivity()),
      vscode.window.onDidChangeActiveTextEditor(() => this.bumpActivity()),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.bumpActivity();
        } else {
          this.refreshState(false);
        }
      })
    );
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

    const systemIdle = getSystemIdleSeconds();
    this.lastSystemIdleSeconds = systemIdle;

    if (systemIdle !== null) {
      this.usingSystemIdle = true;
      if (systemIdle >= this.inactivityTolerance) {
        return 'paused-inactive';
      }
      return 'timing';
    }

    this.usingSystemIdle = false;
    const idleSeconds = (Date.now() - this.lastActivity) / 1000;
    if (idleSeconds >= this.inactivityTimeoutSafe()) {
      return 'paused-inactive';
    }
    return 'timing';
  }

  private inactivityTimeoutSafe(): number {
    return Math.max(5, this.inactivityTolerance);
  }

  private snapshot() {
    return {
      seconds: this.trackedSeconds,
      state: this.currentState,
      systemIdleSeconds: this.lastSystemIdleSeconds,
      inactivityTolerance: this.inactivityTolerance,
      usingSystemIdle: this.usingSystemIdle
    };
  }

  private emitTick() {
    const info = this.snapshot();
    for (const listener of this.tickListeners) {
      listener(info);
    }
  }

  public getTrackingState(): TrackingState {
    return this.currentState;
  }

  public usesSystemIdleDetection(): boolean {
    return this.usingSystemIdle;
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
