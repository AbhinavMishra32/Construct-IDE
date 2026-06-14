import { useCallback, useEffect, useRef, useState } from "react";

import { logStore, type LogEntry } from "../../lib/logStore";

export function useInteractProgressLogBuffer() {
  const [interactProgressLogs, setInteractProgressLogs] = useState<Record<string, LogEntry[]>>({});
  const [interactingId, setInteractingId] = useState<string | null>(null);
  const interactingIdRef = useRef<string | null>(null);

  useEffect(() => {
    interactingIdRef.current = interactingId;
  }, [interactingId]);

  useEffect(() => {
    return logStore.subscribe((channel, entry) => {
      if (channel !== "interact" || entry.message === "--- Log cleared ---") {
        return;
      }
      const activeInteractId = interactingIdRef.current;
      if (!activeInteractId) {
        return;
      }
      setInteractProgressLogs((current) => {
        const entries = current[activeInteractId] ?? [];
        return {
          ...current,
          [activeInteractId]: [...entries.slice(-23), entry]
        };
      });
    });
  }, []);

  const resetInteractProgress = useCallback(() => {
    interactingIdRef.current = null;
    setInteractingId(null);
    setInteractProgressLogs({});
  }, []);

  return {
    interactProgressLogs,
    setInteractProgressLogs,
    interactingId,
    setInteractingId,
    resetInteractProgress
  };
}
