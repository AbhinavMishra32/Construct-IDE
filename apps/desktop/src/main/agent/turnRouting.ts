/** A kickoff starts before its first model turn is registered. Claiming the
 * project here closes that gap so create + immediate open cannot launch two
 * independent conversations for the same project. */
export function claimProject(
  starting: Set<string>,
  running: Map<string, string>,
  projectId: string,
): boolean {
  if (starting.has(projectId) || [...running.values()].includes(projectId)) return false;
  starting.add(projectId);
  return true;
}

export function projectBusy(starting: Set<string>, running: Map<string, string>, projectId: string): boolean {
  return starting.has(projectId) || [...running.values()].includes(projectId);
}
