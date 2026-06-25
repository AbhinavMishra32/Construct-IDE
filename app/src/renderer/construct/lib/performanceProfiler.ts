export type ConstructProfilerEventKind = "frame" | "long-task" | "storage" | "ipc" | "mark";

export type ConstructProfilerEvent = {
  id: number;
  kind: ConstructProfilerEventKind;
  at: number;
  label: string;
  durationMs?: number;
  detail?: Record<string, unknown>;
  severity: "info" | "warn" | "critical";
};

export type ConstructProfilerSnapshot = {
  running: boolean;
  fps: number;
  frameAvgMs: number;
  frameMaxMs: number;
  droppedFrames: number;
  longTaskCount: number;
  longTaskMaxMs: number;
  heapUsedMb: number | null;
  heapLimitMb: number | null;
  events: ConstructProfilerEvent[];
};

type ProfilerListener = (snapshot: ConstructProfilerSnapshot) => void;

const MAX_EVENTS = 240;

class ConstructPerformanceProfiler {
  private listeners = new Set<ProfilerListener>();
  private events: ConstructProfilerEvent[] = [];
  private frameHandle: number | null = null;
  private lastFrameAt = 0;
  private frames: number[] = [];
  private nextEventId = 1;
  private droppedFrames = 0;
  private longTaskCount = 0;
  private longTaskMaxMs = 0;
  private running = false;
  private notifyHandle: number | null = null;
  private longTaskObserver: PerformanceObserver | null = null;

  start(): void {
    if (this.running || typeof window === "undefined") return;
    this.running = true;
    this.lastFrameAt = performance.now();
    this.observeFrames();
    this.observeLongTasks();
    this.scheduleNotify();
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle != null) {
      window.cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    if (this.notifyHandle != null) {
      window.clearInterval(this.notifyHandle);
      this.notifyHandle = null;
    }
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
    this.notify();
  }

  subscribe(listener: ProfilerListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  recordStorageWrite(input: {
    label: string;
    key?: string;
    scope?: string;
    projectId?: string;
    bytes?: number;
  }): void {
    this.record({
      kind: "storage",
      label: input.label,
      detail: {
        key: input.key,
        scope: input.scope ?? "application",
        projectId: input.projectId,
        bytes: input.bytes
      },
      severity: typeof input.bytes === "number" && input.bytes > 250_000 ? "warn" : "info"
    });
  }

  record(input: Omit<ConstructProfilerEvent, "id" | "at"> & { at?: number }): void {
    this.events.push({
      ...input,
      id: this.nextEventId++,
      at: input.at ?? performance.now()
    });
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
    this.notify();
  }

  async measureAsync<T>(label: string, detail: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await run();
      this.record({
        kind: "ipc",
        label,
        durationMs: performance.now() - startedAt,
        detail,
        severity: performance.now() - startedAt > 120 ? "warn" : "info"
      });
      return result;
    } catch (error) {
      this.record({
        kind: "ipc",
        label,
        durationMs: performance.now() - startedAt,
        detail: { ...detail, error: error instanceof Error ? error.message : String(error) },
        severity: "critical"
      });
      throw error;
    }
  }

  snapshot(): ConstructProfilerSnapshot {
    const frames = this.frames.slice(-120);
    const frameAvgMs = frames.length ? frames.reduce((sum, frame) => sum + frame, 0) / frames.length : 0;
    const frameMaxMs = frames.length ? Math.max(...frames) : 0;
    const memory = readMemorySnapshot();
    return {
      running: this.running,
      fps: frameAvgMs > 0 ? Math.min(240, 1000 / frameAvgMs) : 0,
      frameAvgMs,
      frameMaxMs,
      droppedFrames: this.droppedFrames,
      longTaskCount: this.longTaskCount,
      longTaskMaxMs: this.longTaskMaxMs,
      heapUsedMb: memory.heapUsedMb,
      heapLimitMb: memory.heapLimitMb,
      events: [...this.events].reverse()
    };
  }

  private observeFrames(): void {
    const tick = (now: number) => {
      if (!this.running) return;
      const delta = now - this.lastFrameAt;
      this.lastFrameAt = now;
      if (delta > 0 && Number.isFinite(delta)) {
        this.frames.push(delta);
        if (this.frames.length > 240) this.frames.shift();
        if (delta > 34) {
          this.droppedFrames += Math.max(1, Math.round(delta / 16.67) - 1);
          if (delta > 50) {
            this.record({
              kind: "frame",
              label: "slow frame",
              durationMs: delta,
              severity: delta > 100 ? "critical" : "warn"
            });
          }
        }
      }
      this.frameHandle = window.requestAnimationFrame(tick);
    };
    this.frameHandle = window.requestAnimationFrame(tick);
  }

  private observeLongTasks(): void {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTaskCount += 1;
          this.longTaskMaxMs = Math.max(this.longTaskMaxMs, entry.duration);
          this.record({
            kind: "long-task",
            label: entry.name || "main thread long task",
            durationMs: entry.duration,
            severity: entry.duration > 120 ? "critical" : "warn",
            detail: { startTime: Math.round(entry.startTime) }
          });
        }
      });
      this.longTaskObserver.observe({ entryTypes: ["longtask"] });
    } catch {
      this.longTaskObserver = null;
    }
  }

  private scheduleNotify(): void {
    this.notifyHandle = window.setInterval(() => this.notify(), 500);
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of Array.from(this.listeners)) {
      listener(snapshot);
    }
  }
}

function readMemorySnapshot(): { heapUsedMb: number | null; heapLimitMb: number | null } {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  if (!memory) return { heapUsedMb: null, heapLimitMb: null };
  return {
    heapUsedMb: memory.usedJSHeapSize / 1024 / 1024,
    heapLimitMb: memory.jsHeapSizeLimit / 1024 / 1024
  };
}

export const performanceProfiler = new ConstructPerformanceProfiler();

if (typeof window !== "undefined") {
  performanceProfiler.start();
}
