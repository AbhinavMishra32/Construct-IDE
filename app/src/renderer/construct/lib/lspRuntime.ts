import { lspClient } from "./lspClient";

export async function restartProjectLsp(projectId: string) {
  await window.constructProjects.lspStop();
  lspClient.dispose();
  return window.constructProjects.lspStart(projectId);
}
