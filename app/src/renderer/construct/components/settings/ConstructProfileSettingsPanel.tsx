import { useEffect, useMemo, useRef, useState } from "react";
import { PencilSimple, ShareNetwork, Trash, UploadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import {
  Button,
  Input,
  ShadcnDialog,
  ShadcnDialogContent,
  ShadcnDialogFooter,
  ShadcnDialogHeader,
  ShadcnDialogTitle,
  Spinner
} from "@opaline/ui";

import type { AiSettings, ConstructProfile, ConstructProfileActivityEvent, ConstructProfileSnapshot, ProjectSummary } from "../../types";
import { getProfile, updateProfile } from "../../lib/bridge";

const PROFILE_STORAGE_KEY = "construct.profile.v1";
const PROFILE_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#d97706", "#059669"] as const;

const EMPTY_SNAPSHOT: ConstructProfileSnapshot = {
  profile: { name: "Construct User", handle: "@construct-user", avatarColor: PROFILE_COLORS[0], avatarImage: null, updatedAt: null },
  stats: { projects: 0, completedProjects: 0, concepts: 0, flowSessions: 0, verificationPasses: 0, averageProgress: 0 },
  activityEvents: [],
  mostWorkedProject: null,
  projectMix: { flow: 0, tape: 0 },
  evidenceVersion: 1
};

export function ConstructProfileSettingsPanel({
  aiSettings
}: {
  projects: ProjectSummary[];
  aiSettings: AiSettings;
}) {
  const [snapshot, setSnapshot] = useState<ConstructProfileSnapshot>(EMPTY_SNAPSHOT);
  const [profileBusy, setProfileBusy] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const profile = snapshot.profile;
  const activity = useMemo(() => buildProfileActivity(snapshot.activityEvents), [snapshot.activityEvents]);
  const selectedModel = modelForSettings(aiSettings);

  useEffect(() => {
    let cancelled = false;
    void getProfile()
      .then(async (loaded) => {
        let next = loaded;
        const legacy = readLegacyProfile(loaded.profile);
        if (legacy && !loaded.profile.updatedAt) {
          const migrated = await updateProfile({ ...legacy, updatedAt: null });
          window.localStorage.removeItem(PROFILE_STORAGE_KEY);
          next = { ...loaded, profile: migrated };
        }
        if (!cancelled) setSnapshot(next);
      })
      .catch((caught) => {
        if (!cancelled) setProfileError(caught instanceof Error ? caught.message : "Could not load the durable profile.");
      })
      .finally(() => {
        if (!cancelled) setProfileBusy(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function saveProfile(next: ConstructProfile): Promise<boolean> {
    try {
      setProfileError(null);
      const saved = await updateProfile(next);
      setSnapshot((current) => ({ ...current, profile: saved }));
      toast.success("Profile saved to Construct storage.");
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not save the profile.";
      setProfileError(message);
      toast.error(message);
      return false;
    }
  }

  async function shareProfile() {
    const summary = [
      `${profile.name} (${profile.handle}) on Construct`,
      `${snapshot.stats.projects} projects · ${snapshot.stats.completedProjects} completed · ${snapshot.stats.concepts} concepts learned`,
      `${activity.currentStreak} day current streak · ${activity.longestStreak} day longest streak`
    ].join("\n");
    try {
      await navigator.clipboard.writeText(summary);
      toast.success("Profile summary copied.");
    } catch {
      toast.error("Could not copy the profile summary.");
    }
  }

  return (
    <main className="app-settings-surface h-full min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-6 py-8 pb-12">
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={profileBusy} onClick={() => void shareProfile()}>
            <ShareNetwork data-icon="inline-start" />
            Share
          </Button>
          <Button variant="outline" size="sm" disabled={profileBusy} onClick={() => setEditOpen(true)}>
            <PencilSimple data-icon="inline-start" />
            Edit
          </Button>
        </div>

        <header className="flex flex-col items-center gap-3 text-center">
          <ProfileAvatar profile={profile} className="size-16 shadow-sm" />
          <div className="flex flex-col items-center gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span>{profile.handle}</span>
              <span aria-hidden>·</span>
              <span className="rounded-full border px-1.5 py-px text-xs">Construct</span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-2 divide-x divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
          <StatTile label="Projects" value={snapshot.stats.projects} />
          <StatTile label="Completed" value={snapshot.stats.completedProjects} />
          <StatTile label="Concepts" value={snapshot.stats.concepts} />
          <StatTile label="Current streak" value={`${activity.currentStreak}d`} />
          <StatTile label="Longest streak" value={`${activity.longestStreak}d`} />
        </div>

        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="text-sm font-medium">Activity</h2>
          <ActivityHeatmap days={activity.days} />
          <p className="text-xs text-muted-foreground">Built from persisted project opens, Flow turns, completions, verifications, concept engagement, and learning sessions.</p>
        </section>

        <div className="grid gap-x-12 gap-y-7 md:grid-cols-2">
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Activity insights</h2>
            <dl className="flex flex-col gap-2.5">
              <InsightRow label="Most worked project" value={snapshot.mostWorkedProject ?? "—"} />
              <InsightRow label="Flow sessions" value={String(snapshot.stats.flowSessions)} />
              <InsightRow label="Verification passes" value={String(snapshot.stats.verificationPasses)} />
              <InsightRow label="Average progress" value={`${snapshot.stats.averageProgress}%`} />
            </dl>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Current AI setup</h2>
            <dl className="flex flex-col gap-2.5">
              <InsightRow label="Source" value={aiSettings.source === "construct-cloud" ? "Construct Cloud" : "Bring your own key"} />
              <InsightRow label="Provider" value={formatProvider(aiSettings.provider)} />
              <InsightRow label="Model" value={selectedModel} />
              <InsightRow label="Reasoning" value={formatLabel(aiSettings.reasoningEffort)} />
            </dl>
          </section>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Project mix</h2>
          {snapshot.stats.projects > 0 ? (
            <div className="grid gap-x-12 gap-y-3 sm:grid-cols-2">
              <UsageRow label="Flow projects" value={snapshot.projectMix.flow} total={snapshot.stats.projects} />
              <UsageRow label="Tape projects" value={snapshot.projectMix.tape} total={snapshot.stats.projects} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Create a project to begin building your local activity profile.</p>
          )}
        </section>
        {profileError ? <p role="alert" className="text-sm text-destructive">{profileError}</p> : null}
      </div>

      <EditProfileDialog
        open={editOpen}
        profile={profile}
        onOpenChange={setEditOpen}
        onSave={saveProfile}
      />
    </main>
  );
}

function EditProfileDialog({
  open,
  profile,
  onOpenChange,
  onSave
}: {
  open: boolean;
  profile: ConstructProfile;
  onOpenChange: (open: boolean) => void;
  onSave: (profile: ConstructProfile) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(profile);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setDraft(profile);
      setError(null);
    }
    onOpenChange(nextOpen);
  }

  async function chooseAvatar(file: File | undefined) {
    if (!file) return;
    try {
      const avatarImage = await compressAvatarImage(file);
      setDraft((current) => ({ ...current, avatarImage }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not process that image.");
    }
  }

  return (
    <ShadcnDialog open={open} onOpenChange={handleOpenChange}>
      <ShadcnDialogContent className="sm:max-w-[500px]">
        <ShadcnDialogHeader>
          <ShadcnDialogTitle>Edit profile</ShadcnDialogTitle>
        </ShadcnDialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col items-center gap-3">
            <ProfileAvatar profile={draft} className="size-20" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void chooseAvatar(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <UploadSimple data-icon="inline-start" />
                {draft.avatarImage ? "Replace photo" : "Upload photo"}
              </Button>
              {draft.avatarImage ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, avatarImage: null }))}>
                  <Trash data-icon="inline-start" />
                  Remove
                </Button>
              ) : null}
            </div>
            <div className="flex items-center justify-center gap-2">
              {PROFILE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use ${color}`}
                  className="size-5 rounded-full transition-transform hover:scale-110 data-[selected=true]:ring-2 data-[selected=true]:ring-foreground/70 data-[selected=true]:ring-offset-2 data-[selected=true]:ring-offset-background"
                  data-selected={!draft.avatarImage && draft.avatarColor === color}
                  style={{ backgroundColor: color }}
                  onClick={() => setDraft((current) => ({ ...current, avatarColor: color }))}
                />
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Display name</span>
            <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Handle</span>
            <Input value={draft.handle} onChange={(event) => setDraft((current) => ({ ...current, handle: sanitizeHandleDraft(event.target.value) }))} />
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <ShadcnDialogFooter>
          <Button variant="secondary" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button
            disabled={saving || !draft.name.trim() || draft.handle.length < 2}
            onClick={() => {
              setSaving(true);
              void onSave({ ...draft, name: draft.name.trim(), handle: normalizeHandle(draft.handle) })
                .then((saved) => {
                  if (saved) onOpenChange(false);
                })
                .finally(() => setSaving(false));
            }}
          >
            {saving ? <Spinner data-icon="inline-start" /> : null}
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </ShadcnDialogFooter>
      </ShadcnDialogContent>
    </ShadcnDialog>
  );
}

function ProfileAvatar({ profile, className }: { profile: ConstructProfile; className: string }) {
  const initials = profile.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "C";
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center overflow-hidden rounded-full text-xl font-semibold text-white`}
      style={{ backgroundColor: profile.avatarColor }}
    >
      {profile.avatarImage ? <img src={profile.avatarImage} alt="" className="size-full object-cover" /> : initials}
    </span>
  );
}

function ActivityHeatmap({ days }: { days: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...days.map((day) => day.count));
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 p-3">
      <div className="grid w-max grid-flow-col grid-rows-7 gap-1" aria-label="Project activity over the last sixteen weeks">
        {days.map((day) => {
          const level = day.count === 0 ? 0 : Math.max(1, Math.ceil((day.count / max) * 4));
          return (
            <span
              key={day.date}
              title={`${day.date}: ${day.count} project event${day.count === 1 ? "" : "s"}`}
              aria-label={`${day.date}: ${day.count} project events`}
              className="size-3 rounded-[3px] bg-muted data-[level=1]:bg-primary/25 data-[level=2]:bg-primary/45 data-[level=3]:bg-primary/70 data-[level=4]:bg-primary"
              data-level={level}
            />
          );
        })}
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 py-3">
      <span className="text-sm tabular-nums text-foreground">{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm tabular-nums" title={value}>{value}</dd>
    </div>
  );
}

function UsageRow({ label, value, total }: { label: string; value: number; total: number }) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{percentage}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function readLegacyProfile(fallback: ConstructProfile): ConstructProfile | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PROFILE_STORAGE_KEY) ?? "null") as Partial<ConstructProfile> | null;
    if (!stored) return null;
    return {
      name: typeof stored.name === "string" && stored.name.trim() ? stored.name : fallback.name,
      handle: typeof stored.handle === "string" ? normalizeHandle(stored.handle) : fallback.handle,
      avatarColor: typeof stored.avatarColor === "string" ? stored.avatarColor : fallback.avatarColor,
      avatarImage: typeof stored.avatarImage === "string" ? stored.avatarImage : null,
      updatedAt: null
    };
  } catch {
    return null;
  }
}

function normalizeHandle(value: string): string {
  const normalized = value.replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  return `@${normalized || "construct-user"}`;
}

function sanitizeHandleDraft(value: string): string {
  return `@${value.replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32)}`;
}

function buildProfileActivity(events: ConstructProfileActivityEvent[]) {
  const eventCounts = new Map<string, number>();
  for (const event of events) {
    const date = parseActivityDate(event.at);
    if (!date) continue;
    const key = localDateKey(date);
    eventCounts.set(key, (eventCounts.get(key) ?? 0) + 1);
  }
  const today = startOfDay(new Date());
  const days = Array.from({ length: 112 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (111 - index));
    const key = localDateKey(date);
    return { date: key, count: eventCounts.get(key) ?? 0 };
  });
  const activeDates = new Set(days.filter((day) => day.count > 0).map((day) => day.date));
  let currentStreak = 0;
  const cursor = new Date(today);
  if (!activeDates.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (activeDates.has(localDateKey(cursor))) {
    currentStreak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  let longestStreak = 0;
  let running = 0;
  for (const day of days) {
    running = day.count > 0 ? running + 1 : 0;
    longestStreak = Math.max(longestStreak, running);
  }
  return { days, currentStreak, longestStreak };
}

function parseActivityDate(value: string): Date | null {
  const numeric = /^\d+$/.test(value) ? Number(value) : value;
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function modelForSettings(settings: AiSettings): string {
  if (settings.source === "construct-cloud") return settings.constructCloudModel;
  if (settings.provider === "openrouter") return settings.openRouterModel;
  if (settings.provider === "opencode-zen") return settings.opencodeZenModel;
  if (settings.provider === "github-copilot") return settings.githubCopilotModel;
  if (settings.provider === "litellm") return settings.liteLlmModel;
  return settings.openAiModel;
}

function formatProvider(provider: AiSettings["provider"]): string {
  return provider.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function formatLabel(value: string): string {
  return value.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

async function compressAvatarImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const source = await fileToDataUrl(file);
  const image = await loadImage(source);
  const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.84);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode that image."));
    image.src = source;
  });
}
