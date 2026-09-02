import { randomUUID } from "node:crypto";

import type { IpcMain } from "electron";

import type { StoredProject } from "../projects/ConstructProjectTypes";
import { ConstructTerminalService } from "../terminal/ConstructTerminalService";

export class ConstructTerminalIpcController {
  constructor(private readonly options: {
    ipcMain: IpcMain;
    terminal: ConstructTerminalService;
    findProject: (projectId: string) => Promise<StoredProject>;
  }) {}

  register(): void {
    const { ipcMain } = this.options;

    ipcMain.handle("construct:project:terminal-create", async (_event, input) => {
      const project = await this.options.findProject(input.projectId);
      return this.options.terminal.createSession({
        sessionId: randomUUID(),
        project,
        cols: input.cols,
        rows: input.rows
      });
    });

    ipcMain.handle("construct:project:terminal-input", async (_event, input) => {
      this.options.terminal.write(input.sessionId, input.data);
    });

    ipcMain.handle("construct:project:terminal-resize", async (_event, input) => {
      this.options.terminal.resize(input.sessionId, input.cols, input.rows);
    });

    ipcMain.handle("construct:project:terminal-kill", async (_event, input) => {
      this.options.terminal.kill(input.sessionId);
    });
  }
}
