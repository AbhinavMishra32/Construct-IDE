import type { IpcMain } from "electron";

import { ConstructLearningStore } from "../constructLearningStore";
import type { KnowledgeBaseRecord, LearningStatePatch } from "../../shared/constructLearning";

export class ConstructLearningIpcController {
  constructor(private readonly options: {
    ipcMain: IpcMain;
    learningStore: () => ConstructLearningStore;
  }) {}

  register(): void {
    const { ipcMain } = this.options;

    ipcMain.handle("construct:learning:get-state", async () => {
      return this.options.learningStore().getState();
    });

    ipcMain.handle("construct:learning:get-project", async (_event, projectId: string) => {
      return this.options.learningStore().getProjectLearnerState(projectId);
    });

    ipcMain.handle("construct:learning:apply-patch", async (_event, patch: LearningStatePatch) => {
      return this.options.learningStore().applyPatch(patch);
    });

    ipcMain.handle("construct:learning:weak-concepts", async (_event, input?: { projectId?: string }) => {
      return this.options.learningStore().getWeakConcepts(input?.projectId);
    });

    ipcMain.handle("construct:learning:knowledge-save", async (_event, record: KnowledgeBaseRecord) => {
      return this.options.learningStore().saveKnowledgeConcept(record);
    });

    ipcMain.handle("construct:learning:knowledge-open", async (_event, record: KnowledgeBaseRecord) => {
      return this.options.learningStore().openKnowledgeConcept(record);
    });

    ipcMain.handle("construct:learning:knowledge-remove", async (_event, input: { projectId: string; conceptId: string }) => {
      return this.options.learningStore().removeKnowledgeConcept(input.projectId, input.conceptId);
    });
  }
}
