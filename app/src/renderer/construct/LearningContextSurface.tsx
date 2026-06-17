import { useEffect, useState, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@opaline/ui";

import type { ConstructLearningState } from "../../shared/constructLearning";
import { getLearningState } from "./lib/bridge";


export function LearningContextSurface() {
  const [state, setState] = useState<ConstructLearningState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLearningState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <div className="p-4"><Alert variant="destructive"><AlertTitle>Could not load learner context</AlertTitle><AlertDescription>{error}</AlertDescription></Alert></div>;
  }

  if (!state) {
    return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">Loading context...</div>;
  }

  const projects = Object.values(state.projects);
  const globalConcepts = Object.values(state.learner.globalConceptUnderstanding);
  const knowledge = Object.values(state.knowledgeBase.concepts);
  const sessions = projects.flatMap((project) => project.constructInteractSessions);
  const recalls = projects.flatMap((project) => project.recallAttempts);
  const assistance = state.learner.assistanceEvents;
  const weakConcepts = globalConcepts.filter((concept) => concept.confidence === "weak" || concept.confidence === "unknown");

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5 p-4">
      <header className="flex items-start justify-between gap-6">
        <div>
          <span className="text-xs font-medium text-muted-foreground">Local-first learner memory</span>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">Context</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">Inspect the local state Construct Interact, recall, Knowledge Base, and future sync will use.</p>
        </div>
        <code className="rounded-full border bg-background/70 px-2 py-1 text-xs text-muted-foreground">{state.sync.mode} · {state.sync.deviceId.slice(0, 8)}</code>
      </header>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <LearningStat label="Concepts" value={globalConcepts.length} />
        <LearningStat label="Weak" value={weakConcepts.length} />
        <LearningStat label="Knowledge" value={knowledge.length} />
        <LearningStat label="Interact" value={sessions.length} />
        <LearningStat label="Recall" value={recalls.length} />
      </section>

      <main className="grid gap-3 lg:grid-cols-2">
        <LearningPanel title="Weak concepts" meta={`${weakConcepts.length} global`}>
          {weakConcepts.slice(0, 8).map((concept) => (
            <LearningRow key={concept.conceptId} title={concept.conceptId} meta={`${concept.confidence} · ${concept.projectIds.length} project`} />
          ))}
          {weakConcepts.length === 0 ? <p>No weak concepts recorded yet.</p> : null}
        </LearningPanel>

        <LearningPanel title="Projects" meta={`${projects.length} tracked`}>
          {projects.slice(0, 8).map((project) => (
            <LearningRow
              key={project.projectId}
              title={project.projectId}
              meta={`${Object.keys(project.conceptUnderstanding).length} concepts · ${project.recallAttempts.length} recalls · ${project.constructInteractSessions.length} interact`}
            />
          ))}
        </LearningPanel>

        <LearningPanel title="Knowledge Base" meta={`${knowledge.length} saved`}>
          {knowledge.slice(0, 8).map((record) => (
            <LearningRow key={`${record.sourceProjectId}:${record.id}`} title={record.title} meta={`${record.sourceProjectTitle} · opened ${record.openCount} times`} />
          ))}
          {knowledge.length === 0 ? <p>No saved concepts yet.</p> : null}
        </LearningPanel>

        <LearningPanel title="Construct Interact" meta={`${sessions.length} sessions`}>
          {sessions.slice(-8).reverse().map((session) => (
            <LearningRow
              key={session.id}
              title={session.prompt}
              meta={session.assessment
                ? `${session.assessment.status} · ${session.assessment.confidence} · ${session.assessment.assistanceLevel}`
                : session.runStatus ?? "completed"}
            />
          ))}
          {sessions.length === 0 ? <p>No Construct Interact sessions yet.</p> : null}
        </LearningPanel>

        <LearningPanel title="Recall attempts" meta={`${recalls.length} attempts`}>
          {recalls.slice(-8).reverse().map((attempt) => (
            <LearningRow key={attempt.id} title={attempt.recallId} meta={`${attempt.mode} · ${attempt.status ?? "pending"} · ${attempt.confidence}`} />
          ))}
          {recalls.length === 0 ? <p>No recall attempts recorded yet.</p> : null}
        </LearningPanel>

        <LearningPanel title="Sync metadata" meta={state.sync.updatedAt}>
          <LearningRow title="Mode" meta={state.sync.mode} />
          <LearningRow title="Pending operations" meta={String(state.sync.pendingOperations.length)} />
          <LearningRow title="Adaptive overlays" meta={state.learner.preferences.adaptiveOverlaysEnabled ? "enabled" : "off by default"} />
          <LearningRow title="Assistance events" meta={String(assistance.length)} />
        </LearningPanel>
      </main>
    </div>
  );
}

function LearningStat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="bg-card/70 shadow-none">
      <CardHeader className="p-3">
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle className="text-lg">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function LearningPanel({ children, meta, title }: { children: ReactNode; meta: string; title: string }) {
  return (
    <Card className="bg-card/70 shadow-none">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">{meta}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 p-3 pt-0">{children}</CardContent>
    </Card>
  );
}

function LearningRow({ meta, title }: { meta: string; title: string }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4 rounded-[7px] px-2 py-1 text-sm hover:bg-muted/60">
      <strong className="min-w-0 truncate font-medium">{title}</strong>
      <small className="shrink-0 text-xs text-muted-foreground">{meta}</small>
    </div>
  );
}
