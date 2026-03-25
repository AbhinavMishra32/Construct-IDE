import { AsyncLocalStorage } from "node:async_hooks";

export type RequestUserContext = {
  id: string;
  email: string;
  displayName: string;
};

export type RequestAuthContext = {
  user: RequestUserContext | null;
  sessionId: string | null;
  sessionToken: string | null;
};

const requestAuthStorage = new AsyncLocalStorage<RequestAuthContext>();

export function runWithRequestAuthContext<T>(
  context: RequestAuthContext,
  task: () => T
): T {
  return requestAuthStorage.run(context, task);
}

export function getRequestAuthContext(): RequestAuthContext | null {
  return requestAuthStorage.getStore() ?? null;
}

export function getCurrentUserId(): string {
  return (
    requestAuthStorage.getStore()?.user?.id ??
    process.env.CONSTRUCT_USER_ID?.trim() ??
    "local-user"
  );
}
