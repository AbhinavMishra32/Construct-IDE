import type { IpcMain } from "electron";

import { ConstructAuthoringReviewService } from "../ai/ConstructAuthoringReviewService";
import { ConstructCodeGhostService } from "../ai/ConstructCodeGhostService";
import { ConstructInteractService } from "../ai/ConstructInteractService";
import { ConstructSelectionExplainService } from "../ai/ConstructSelectionExplainService";
import { ConstructVerifierService } from "../ai/ConstructVerifierService";
import type { StoredProject } from "../projects/ConstructProjectTypes";
import type { ConstructInteractRuntimeInput } from "../../shared/constructLearning";

export class ConstructAgentIpcController {
  constructor(private readonly options: {
    ipcMain: IpcMain;
    readProjects: () => Promise<StoredProject[]>;
    findProject: (projects: StoredProject[], projectId: string) => StoredProject;
    interact: ConstructInteractService;
    verifier: ConstructVerifierService;
    authoringReview: ConstructAuthoringReviewService;
    selectionExplain: ConstructSelectionExplainService;
    codeGhost: ConstructCodeGhostService;
  }) {}

  register(): void {
    const { ipcMain } = this.options;

    ipcMain.handle("construct:project:interact", async (_event, input: Omit<ConstructInteractRuntimeInput, "learningState">) => {
      const project = await this.projectById(input.projectId);
      return this.options.interact.evaluate(project, input);
    });

    ipcMain.handle("construct:project:verify-recall", async (_event, input) => {
      const project = await this.projectById(String(input?.projectId ?? ""));
      return this.options.verifier.verifyRecall(project, input);
    });

    ipcMain.handle("construct:project:review-authoring", async (_event, input) => {
      return this.options.authoringReview.review(input);
    });

    ipcMain.handle("construct:project:explain-selection", async (_event, input) => {
      const project = await this.projectById(String(input?.projectId ?? ""));
      return this.options.selectionExplain.explain(project, input);
    });

    ipcMain.on("construct:project:code-ghost:explain", (event, input) => {
      this.options.codeGhost.explain(event.sender, input);
    });
  }

  private async projectById(projectId: string): Promise<StoredProject> {
    return this.options.findProject(await this.options.readProjects(), projectId);
  }
}
