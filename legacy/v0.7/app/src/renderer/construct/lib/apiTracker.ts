import type { ProjectSettings } from "../types";

export type ActiveCall = {
  id: string;
  key: string;
  label: string;
  startedAt: number;
};

type ApiTrackerListener = () => void;

class ApiTrackerClass {
  private activeCalls: ActiveCall[] = [];
  private settings: ProjectSettings | null = null;
  private gitBranch: string | null = null;
  private gitDirtyCount: number = 0;
  private lspStatus: string | null = null;
  private listeners = new Set<ApiTrackerListener>();
  private nextId = 1;

  constructor() {
    // Attempt to load settings asynchronously on init
    setTimeout(() => {
      void this.refreshSettings();
    }, 100);
  }

  async refreshSettings() {
    if (window.constructProjects) {
      try {
        const settings = await window.constructProjects.getSettings();
        this.settings = settings;
        this.notify();
      } catch (err) {
        console.error("Failed to load settings in apiTracker", err);
      }
    }
  }

  getActiveCalls(): ActiveCall[] {
    return this.activeCalls;
  }

  getSettings(): ProjectSettings | null {
    return this.settings;
  }

  getGitBranch(): string | null {
    return this.gitBranch;
  }

  getGitDirtyCount(): number {
    return this.gitDirtyCount;
  }

  getLspStatus(): string | null {
    return this.lspStatus;
  }

  setGit(branch: string | null, dirtyCount: number) {
    if (this.gitBranch !== branch || this.gitDirtyCount !== dirtyCount) {
      this.gitBranch = branch;
      this.gitDirtyCount = dirtyCount;
      this.notify();
    }
  }

  setLspStatus(status: string | null) {
    if (this.lspStatus !== status) {
      this.lspStatus = status;
      this.notify();
    }
  }

  start(key: string, label: string): string {
    const id = `${key}-${this.nextId++}`;
    this.activeCalls.push({ id, key, label, startedAt: Date.now() });
    this.notify();
    return id;
  }

  end(id: string) {
    this.activeCalls = this.activeCalls.filter(c => c.id !== id);
    this.notify();
  }

  subscribe(listener: ApiTrackerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch (err) {
        console.error("Error in apiTracker listener:", err);
      }
    });
  }
}

export const apiTracker = new ApiTrackerClass();
