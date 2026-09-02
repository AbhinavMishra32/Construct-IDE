import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { DebugProcessSnapshot } from "../terminal/ConstructTerminalService";

const execFileAsync = promisify(execFile);

export class ProcessInspector {
  async hydrate(snapshots: DebugProcessSnapshot[]): Promise<DebugProcessSnapshot[]> {
    const pids = snapshots
      .map((snapshot) => snapshot.pid)
      .filter((pid): pid is number => typeof pid === "number" && pid > 0);

    if (pids.length === 0) {
      return snapshots;
    }

    try {
      const { stdout } = await execFileAsync("ps", [
        "-o",
        "pid=,%cpu=,rss=,etime=,command=",
        "-p",
        pids.join(",")
      ]);
      const byPid = new Map<number, { cpuPercent: number | null; memoryMb: number | null; elapsed: string | null; command: string | null }>();

      for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(/^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s*(.*)$/);
        if (!match) {
          continue;
        }

        const pid = Number(match[1]);
        byPid.set(pid, {
          cpuPercent: Number(match[2]),
          memoryMb: Math.round((Number(match[3]) / 1024) * 10) / 10,
          elapsed: match[4] || null,
          command: match[5] || null
        });
      }

      for (const snapshot of snapshots) {
        if (!snapshot.pid) {
          continue;
        }
        const resource = byPid.get(snapshot.pid);
        if (!resource) {
          continue;
        }
        snapshot.cpuPercent = resource.cpuPercent;
        snapshot.memoryMb = resource.memoryMb;
        snapshot.elapsed = resource.elapsed;
        snapshot.command = snapshot.command ?? resource.command ?? undefined;
      }
    } catch (error) {
      console.warn("[debug] Unable to collect process resources:", error);
    }

    return snapshots;
  }
}
