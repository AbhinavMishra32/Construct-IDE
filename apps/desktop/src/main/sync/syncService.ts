import path from "node:path";

import type { ProjectStore } from "../store/projectStore.js";
import type { LearnerProfileService } from "../learner/learnerProfile.js";
import type { SyncPull, SyncResult, SyncStatus } from "../../shared/sync.js";

/**
 * Keeping one machine's copy in step with the account's.
 *
 * Construct is local-first and that is not a slogan here: the desktop owns the
 * truth, works with no network at all, and syncs because a learner has more
 * than one machine and because losing a laptop should not lose what they
 * understand. Nothing in this file is on the path of a turn — if the cloud is
 * unreachable the app carries on exactly as it did.
 *
 * One request per sync: push what changed since the cursor, receive what other
 * devices changed, write it, store the new cursor. The cursor is the server's
 * clock rather than this machine's, because two laptops with a minute of drift
 * between them would otherwise each skip or repeat a minute of each other's
 * work.
 *
 * The cursor is stored only after the write succeeds. A sync that pulls rows
 * and then fails to apply them must ask for them again, and asking twice for
 * rows already held is free — every write is an upsert keyed by the row's own
 * identity.
 */
/**
 * Two cursors, and they are not interchangeable.
 *
 * `REMOTE` is the server's clock, sent back as `since` so it can decide what
 * this device has not seen. `LOCAL` is this machine's clock, used to decide
 * what it has to say.
 *
 * Comparing local rows against the server's clock is the bug this splits apart.
 * Two machines are never exactly in step, and a laptop running a few seconds
 * behind would stamp a change with a time already before the cursor it was
 * handed — so the change would look old on every subsequent sync and never be
 * pushed at all. Silent, permanent, and only visible as "my other laptop never
 * got it".
 */
const REMOTE = "sync-cursor";
const LOCAL = "sync-cursor-local";

export class SyncService {
  private status: SyncStatus = { state: "idle", at: null };
  /** One sync at a time. Two overlapping runs would each push a cursor the
   *  other did not see, and the later one would move it backwards. */
  private running: Promise<SyncResult | null> | null = null;

  constructor(
    private readonly store: ProjectStore,
    private readonly origin: string,
    /** The bearer token for the signed-in account, or null when nobody is. */
    private readonly token: () => Promise<string | null>,
    /** Where a project pulled from another machine should live on this one. */
    private readonly projectsRoot: () => string,
    /* The profile is a setting rather than a table, so it is carried by the
       service that owns it instead of coming out of `changedSince` with the
       rows. It is here at all because signing out empties the device: without a
       copy in the cloud, signing back in looks exactly like never having done
       the intake. */
    private readonly learner: LearnerProfileService,
    private readonly emit: (status: SyncStatus) => void,
  ) {}

  current(): SyncStatus {
    return this.status;
  }

  /** Runs a sync, or joins the one already running. */
  async run(): Promise<SyncResult | null> {
    if (this.running) return this.running;
    this.running = this.exchange().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async exchange(): Promise<SyncResult | null> {
    const token = await this.token().catch(() => null);
    /* Signed out is not an error state. The app is fully usable without an
       account, and a red light for choosing that would be a lie. */
    if (!token) return null;

    this.report({ state: "syncing", at: this.status.at });

    const since = this.store.getSetting<string | null>(REMOTE, null);
    /* Read before the request, and stored only if it succeeds: anything written
       while this sync is in flight has to be caught by the next one rather than
       skipped by a cursor that ran ahead of it. */
    const localFrom = this.store.getSetting<string | null>(LOCAL, null);
    const localNow = new Date().toISOString();
    const push = this.store.changedSince(localFrom);

    try {
      const response = await fetch(`${this.origin}/v1/sync`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ since, ...push, learner: this.learner.syncable() }),
        /* Bounded, because this runs on a timer and a request that never
           settles would hold the single-flight lock for the session. */
        signal: AbortSignal.timeout(30_000),
      });

      if (response.status === 401) {
        /* The session expired. Not an error the learner can act on from here —
           the account panel is where signing in happens — so this settles quiet
           rather than red. */
        this.report({ state: "idle", at: this.status.at });
        return null;
      }
      if (!response.ok) throw new Error(`The cloud answered ${response.status}.`);

      const pull = (await response.json()) as SyncPull & { now: string };
      this.store.applyRemote(pull, (project) => this.directoryFor(project));
      /* Before the cursor moves, like every other write here: a profile pulled
         and then not applied has to be asked for again. */
      if (pull.learner) await this.learner.adopt(pull.learner);
      /* Only now. A sync that pulled rows and then failed to apply them must
         ask for them again, and asking twice is free — every write is an upsert
         keyed by the row's own identity. */
      this.store.setSetting(REMOTE, pull.now);
      this.store.setSetting(LOCAL, localNow);

      const result: SyncResult = {
        pushed: count(push),
        pulled: count(pull),
        at: pull.now,
      };
      this.report({ state: "idle", at: pull.now });
      return result;
    } catch (cause) {
      /* Offline is told apart from broken, because they are different news: one
         resolves itself and the other does not. */
      const offline = cause instanceof TypeError || (cause instanceof Error && cause.name === "TimeoutError");
      this.report({
        state: offline ? "offline" : "error",
        at: this.status.at,
        error: cause instanceof Error ? cause.message : "Sync failed.",
      });
      return null;
    }
  }

  /**
   * Where a project from another machine lands here.
   *
   * The cloud does not carry a directory, so this machine chooses one — under
   * the learner's own projects folder, named after the project, and suffixed
   * if that name is taken. The files themselves are not synced, so what appears
   * is an empty folder with the whole conversation and everything Construct
   * knows about it: enough to read what was learned, and to carry on.
   */
  private directoryFor(project: { id: string; name: string }): string {
    const root = this.projectsRoot();
    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
    /* The id's tail rather than a counter: two machines choosing a directory
       for the same project must choose the same one, and a counter depends on
       what else happens to be on this disk. */
    return path.join(root, `${slug}-${project.id.slice(0, 6)}`);
  }

  private report(status: SyncStatus): void {
    this.status = status;
    this.emit(status);
  }
}

const count = (payload: Partial<SyncPull>): number =>
  (payload.projects?.length ?? 0) +
  (payload.messages?.length ?? 0) +
  (payload.concepts?.length ?? 0) +
  (payload.tasks?.length ?? 0) +
  (payload.pathNodes?.length ?? 0) +
  ((payload as Partial<SyncPull>).learner ? 1 : 0);
