import {
  ArrowRightIcon,
  BookMarkedIcon,
  BrainCircuitIcon,
  DatabaseZapIcon,
  EyeIcon,
  GitCommitHorizontalIcon,
  Layers2Icon,
  RadarIcon,
  RouteIcon,
  SparklesIcon,
  TerminalSquareIcon,
  WorkflowIcon
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@construct/ui";

const heroSignals = ["Electron desktop", "Local-first runner", "Adaptive mentor"];

function FeatureVisualFrame({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-border/70 bg-background/72 p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(79,140,255,0.12),transparent_34%)]" />
      {children}
    </div>
  );
}

function SpineVisual() {
  return (
    <FeatureVisualFrame>
      <div className="relative grid gap-4">
        <div className="absolute inset-x-6 top-9 h-px bg-gradient-to-r from-blue-500/0 via-blue-500/60 to-emerald-400/0" />
        <div className="grid grid-cols-4 gap-3">
          {["Scaffold", "Parser", "Runner", "Cache"].map((item, index) => (
            <div key={item} className="relative flex flex-col gap-2">
              <span className="size-3 rounded-full border border-blue-400/60 bg-background shadow-[0_0_0_6px_rgba(79,140,255,0.12)]" />
              <div className="rounded-2xl border border-border/70 bg-muted/65 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  0{index + 1}
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">{item}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
            milestone graph
          </div>
          <div className="rounded-xl border border-blue-400/20 bg-blue-400/10 px-3 py-2 text-xs text-blue-200">
            dependency order
          </div>
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
            runnable states
          </div>
        </div>
      </div>
    </FeatureVisualFrame>
  );
}

function RepoVisual() {
  return (
    <FeatureVisualFrame>
      <div className="grid gap-3 md:grid-cols-[0.9fr_1.1fr]">
        <div className="grid gap-2">
          <div className="rounded-xl border border-border/70 bg-muted/60 px-3 py-2 text-sm text-foreground">
            packages/
          </div>
          <div className="ml-4 rounded-xl border border-border/70 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            core-lib/
          </div>
          <div className="ml-8 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-foreground">
            src/cache.ts
          </div>
          <div className="ml-8 rounded-xl border border-border/70 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            src/graph.ts
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-[#0f1012] p-4 font-mono text-xs leading-6 text-white/72">
          <div className="text-white/44">{"// TODO: learner implements this region"}</div>
          <div>export function hydrateCache(state) {"{"}</div>
          <div className="pl-4 text-blue-300">return restoreMaskedEntries(state);</div>
          <div>{"}"}</div>
        </div>
      </div>
    </FeatureVisualFrame>
  );
}

function MentorVisual() {
  return (
    <FeatureVisualFrame>
      <div className="grid gap-3">
        <div className="max-w-[85%] rounded-[18px] rounded-bl-md border border-border/70 bg-muted/60 px-4 py-3 text-sm text-foreground">
          You are blocked on dependency ordering, not syntax.
        </div>
        <div className="ml-auto max-w-[72%] rounded-[18px] rounded-br-md border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
          Ask whether the blocker is Turbo semantics or package-output conventions.
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground">
            explain
          </span>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
            diagnose
          </span>
          <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
            adapt frontier
          </span>
        </div>
      </div>
    </FeatureVisualFrame>
  );
}

function KnowledgeVisual() {
  return (
    <FeatureVisualFrame>
      <div className="relative h-40 overflow-hidden rounded-2xl bg-gradient-to-br from-background/40 to-muted/20">
        <div className="absolute left-[18%] top-[24%] h-px w-[46%] rotate-[12deg] bg-border/80" />
        <div className="absolute left-[34%] top-[52%] h-px w-[34%] -rotate-[18deg] bg-border/70" />
        <div className="absolute left-[22%] top-[64%] h-px w-[28%] rotate-[22deg] bg-border/60" />
        <div className="absolute left-[12%] top-[18%] rounded-full border border-blue-500/40 bg-blue-500/12 px-3 py-1 text-xs text-blue-100">
          KV cache
        </div>
        <div className="absolute left-[50%] top-[20%] rounded-full border border-border/70 bg-background/76 px-3 py-1 text-xs text-foreground">
          Parser design
        </div>
        <div className="absolute left-[28%] top-[58%] rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
          Rust ownership
        </div>
        <div className="absolute left-[60%] top-[66%] rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
          Learned in KV toolkit
        </div>
      </div>
    </FeatureVisualFrame>
  );
}

function ObservabilityVisual() {
  return (
    <FeatureVisualFrame>
      <div className="grid gap-2">
        {[
          ["planning-intake", "running", "blue"],
          ["spine-generation", "persisted", "emerald"],
          ["frontier-authoring", "streaming", "amber"],
          ["hidden-validations", "queued", "slate"]
        ].map(([label, status, tone]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/55 px-3 py-2"
          >
            <div className="flex items-center gap-3">
              <span
                className={`size-2 rounded-full ${
                  tone === "blue"
                    ? "bg-blue-400 shadow-[0_0_0_5px_rgba(79,140,255,0.14)]"
                    : tone === "emerald"
                      ? "bg-emerald-400 shadow-[0_0_0_5px_rgba(52,211,153,0.14)]"
                      : tone === "amber"
                        ? "bg-amber-300 shadow-[0_0_0_5px_rgba(251,191,36,0.14)]"
                        : "bg-zinc-500 shadow-[0_0_0_5px_rgba(113,113,122,0.14)]"
                }`}
              />
              <span className="text-sm text-foreground">{label}</span>
            </div>
            <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
              {status}
            </span>
          </div>
        ))}
      </div>
    </FeatureVisualFrame>
  );
}

function OwnershipVisual() {
  return (
    <FeatureVisualFrame>
      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div className="rounded-2xl border border-border/70 bg-muted/60 p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            system repo
          </div>
          <div className="mt-2 text-sm font-medium text-foreground">hidden staged history</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full bg-background/80 px-2 py-1 text-xs text-muted-foreground">
              checkpoints
            </span>
            <span className="rounded-full bg-background/80 px-2 py-1 text-xs text-muted-foreground">
              rollback
            </span>
          </div>
        </div>
        <div className="flex justify-center text-muted-foreground">
          <ArrowRightIcon />
        </div>
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-blue-100/80">
            your repo
          </div>
          <div className="mt-2 text-sm font-medium text-blue-50">real authored commits</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full bg-black/20 px-2 py-1 text-xs text-blue-100/80">
              push to github
            </span>
            <span className="rounded-full bg-black/20 px-2 py-1 text-xs text-blue-100/80">
              truthful ownership
            </span>
          </div>
        </div>
      </div>
    </FeatureVisualFrame>
  );
}

const featureCards = [
  {
    icon: Layers2Icon,
    badge: "Stable spine",
    title: "Generate the architecture once. Rewrite the next few moves live.",
    description:
      "Canonical final project, capability graph, milestones, staged commits, and route hypothesis up front. Only the next frontier gets deeply rewritten.",
    visual: SpineVisual,
    wide: true
  },
  {
    icon: GitCommitHorizontalIcon,
    badge: "Real repo",
    title: "Each step is a runnable project state, not a detached exercise.",
    description:
      "The visible tree grows naturally, masked regions preserve validity, and the learner works in the actual project code.",
    visual: RepoVisual
  },
  {
    icon: BrainCircuitIcon,
    badge: "Mentor panel",
    title: "Diagnosis, hints, checks, and path changes sit right beside the code.",
    description:
      "The guide explains the blocker, asks targeted questions, and tells you why the path changed.",
    visual: MentorVisual
  },
  {
    icon: BookMarkedIcon,
    badge: "Knowledge graph",
    title: "Track concepts by project source, revision artifact, and actual evidence.",
    description:
      "Review what you learned by concept or by project, reopen examples, and jump back into the exact teaching step.",
    visual: KnowledgeVisual
  },
  {
    icon: EyeIcon,
    badge: "Observability",
    title: "See build stages, generated files, agent context, and live blueprint state.",
    description:
      "DB-backed blueprint builds, live event streams, and a deep debug view for what the agent did and why.",
    visual: ObservabilityVisual
  },
  {
    icon: DatabaseZapIcon,
    badge: "Ownership",
    title: "User auth, provider connections, and your own git history stay first-class.",
    description:
      "System history stays hidden while your repo, your commits, and your authorship stay truthful.",
    visual: OwnershipVisual
  }
];

const workflowSteps = [
  {
    title: "Architect the project",
    description:
      "Gather intake, update the learner graph, and generate the stable spine."
  },
  {
    title: "Materialize the current commit",
    description:
      "Open only the visible workspace slice, with runnable placeholders and focused tasks."
  },
  {
    title: "Code, test, and ask questions",
    description:
      "Work in the real repo while hidden validations and visible output keep the build honest."
  },
  {
    title: "Diagnose and adapt",
    description:
      "Construct mutates only the future frontier, not the progress you already earned."
  }
];

const platformSignals = [
  {
    icon: WorkflowIcon,
    title: "LangGraph orchestration",
    description:
      "Project creation, adaptive frontier mutation, and runtime diagnosis all live on the same agent backbone."
  },
  {
    icon: RadarIcon,
    title: "LangSmith-ready tracing",
    description:
      "Track build stages, event streams, and future path rewrites with deep observability from day one."
  },
  {
    icon: RouteIcon,
    title: "Visible output every few steps",
    description:
      "CLI results, previews, traces, or runtime state changes keep the project feeling alive."
  },
  {
    icon: TerminalSquareIcon,
    title: "Desktop-native workbench",
    description:
      "A serious, focused environment with code, guide, output, history, and project context in one place."
  }
];

const architectBullets = [
  "Canonical hidden final project",
  "Capability graph and milestone order",
  "Coarse internal commit graph",
  "Initial learner route hypothesis"
];

const workspaceBullets = [
  "Visible tree grows commit by commit",
  "Masked regions keep the repo runnable",
  "Hidden validations stay meaningful",
  "You write the code that matters"
];

const mentorBullets = [
  "Explain the current blocker",
  "Ask a targeted diagnostic question",
  "Split the next capability if needed",
  "Show why the path changed"
];

export function LandingPage() {
  return (
    <main className="relative overflow-hidden">
      <div className="landing-backdrop" aria-hidden="true">
        <span className="landing-orb landing-orb-blue" />
        <span className="landing-orb landing-orb-green" />
        <span className="landing-orb landing-orb-gold" />
        <div className="landing-grid" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-20 pt-5 sm:px-6 lg:px-8">
        <header className="sticky top-0 z-20 mb-8 flex items-center justify-between gap-4 rounded-full border border-border/70 bg-background/72 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl border border-border/80 bg-card text-sm font-semibold tracking-[0.18em] text-foreground">
              CT
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-[-0.02em] text-foreground">
                Construct
              </span>
              <span className="text-xs text-muted-foreground">Learning-first desktop IDE</span>
            </div>
          </div>

          <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#workflow" className="transition-colors hover:text-foreground">
              Workflow
            </a>
            <a href="#platform" className="transition-colors hover:text-foreground">
              Platform
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href="#features">Tour</a>
            </Button>
            <Button asChild size="sm">
              <a href="mailto:hello@tryconstruct.cc">
                Get access
                <ArrowRightIcon data-icon="inline-end" />
              </a>
            </Button>
          </div>
        </header>

        <section className="grid items-center gap-8 pb-16 pt-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-10">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap gap-2">
              {heroSignals.map((signal) => (
                <Badge key={signal} variant="outline">
                  {signal}
                </Badge>
              ))}
            </div>

            <div className="flex flex-col gap-4">
              <h1 className="max-w-[10ch] text-balance text-5xl font-medium leading-[0.92] tracking-[-0.09em] text-foreground sm:text-6xl lg:text-7xl">
                Learn software engineering at Claude Code speed.
              </h1>
              <p className="max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
                Construct brings back the fun of learning software engineering in
                the age of vibe coding. AI shapes the path, but you still build the
                real thing through architecture, runnable commits, and adaptive
                mentoring.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <a href="mailto:hello@tryconstruct.cc">
                  Request early access
                  <ArrowRightIcon data-icon="inline-end" />
                </a>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#workflow">See how it works</a>
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="bg-card/88 backdrop-blur-xl">
                <CardHeader>
                  <CardDescription>Stable spine</CardDescription>
                  <CardTitle>Canonical target</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm leading-7 text-muted-foreground">
                  Final architecture, milestone graph, commit skeleton, and learner route.
                </CardContent>
              </Card>
              <Card className="bg-card/88 backdrop-blur-xl">
                <CardHeader>
                  <CardDescription>Adaptive frontier</CardDescription>
                  <CardTitle>Next 1-3 steps only</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm leading-7 text-muted-foreground">
                  Explanation, checks, masking, tests, and preview rewrite after evaluation.
                </CardContent>
              </Card>
              <Card className="bg-card/88 backdrop-blur-xl">
                <CardHeader>
                  <CardDescription>Real ownership</CardDescription>
                  <CardTitle>Your repo</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm leading-7 text-muted-foreground">
                  User-authored git history, truthful authorship, and no fake vibe-coded shortcuts.
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="overflow-hidden border-border/80 bg-card/88 backdrop-blur-xl">
            <Tabs defaultValue="architect" className="gap-0">
              <CardHeader className="gap-4 border-b border-border/80">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                    <span className="size-2.5 rounded-full bg-[#febc2e]" />
                    <span className="size-2.5 rounded-full bg-[#28c840]" />
                  </div>
                  <Badge variant="outline">Desktop-native workbench</Badge>
                </div>

                <TabsList>
                  <TabsTrigger value="architect">Architect</TabsTrigger>
                  <TabsTrigger value="workspace">Workspace</TabsTrigger>
                  <TabsTrigger value="mentor">Mentor</TabsTrigger>
                </TabsList>
              </CardHeader>

              <CardContent className="p-5">
                <TabsContent value="architect" className="mt-0">
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                    <Card className="bg-muted/35 shadow-none">
                      <CardHeader>
                        <div className="flex items-center justify-between gap-3">
                          <Badge variant="outline">Project architect</Badge>
                          <Badge variant="secondary">Stable spine ready</Badge>
                        </div>
                        <CardTitle>Generate the whole system once, then stay focused.</CardTitle>
                        <CardDescription>
                          Build the canonical target, capability order, milestone graph,
                          staged commits, and learner route before coding starts.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-2 pt-0">
                        {architectBullets.map((item) => (
                          <div
                            key={item}
                            className="rounded-xl border border-border/70 bg-background/72 px-3 py-3 text-sm text-muted-foreground"
                          >
                            {item}
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    <Card className="bg-muted/35 shadow-none">
                      <CardHeader>
                        <CardDescription>Current frontier</CardDescription>
                        <CardTitle>What the agent is preparing now</CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-2 pt-0">
                        <div className="rounded-xl border border-border/70 bg-background/72 px-3 py-3 text-sm">
                          Explain Turbo graph semantics
                        </div>
                        <div className="rounded-xl border border-border/70 bg-background/72 px-3 py-3 text-sm">
                          Implement `turbo.json` outputs
                        </div>
                        <div className="rounded-xl border border-border/70 bg-background/72 px-3 py-3 text-sm">
                          Hidden validation + preview
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="workspace" className="mt-0">
                  <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
                    <Card className="bg-muted/35 shadow-none">
                      <CardHeader>
                        <CardDescription>Visible tree</CardDescription>
                        <CardTitle>Only what exists right now</CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-2 pt-0 text-sm text-muted-foreground">
                        {workspaceBullets.map((item, index) => (
                          <div
                            key={item}
                            className={`rounded-xl border px-3 py-3 ${
                              index === 1
                                ? "border-blue-500/30 bg-blue-500/10 text-foreground"
                                : "border-border/70 bg-background/72"
                            }`}
                          >
                            {item}
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    <Card className="bg-[#0f1012] text-white shadow-none">
                      <CardHeader>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline" className="border-white/10 text-white/80">
                            Code
                          </Badge>
                          <Badge variant="outline" className="border-white/10 text-white/80">
                            Step 2
                          </Badge>
                          <Badge variant="outline" className="border-white/10 text-white/80">
                            1 hidden validation
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <pre className="overflow-x-auto rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm leading-7 text-white/88">
                          <code>{`export function mergeState(base, patch) {
  return {
    ...base,
    ...patch,
    cache: {
      ...base.cache,
      ...patch.cache,
    },
  };
}`}</code>
                        </pre>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="mentor" className="mt-0">
                  <div className="grid gap-4 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                    <Card className="bg-muted/35 shadow-none">
                      <CardHeader>
                        <div className="flex items-center justify-between gap-3">
                          <Badge variant="outline">Guide panel</Badge>
                          <Badge variant="secondary">Diagnosis active</Badge>
                        </div>
                        <CardTitle>You are blocked on dependency ordering, not syntax.</CardTitle>
                        <CardDescription>
                          The system should deepen Turbo graph semantics before asking
                          for another full implementation attempt.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-2 pt-0 text-sm text-muted-foreground">
                        {mentorBullets.map((item) => (
                          <div
                            key={item}
                            className="rounded-xl border border-border/70 bg-background/72 px-3 py-3"
                          >
                            {item}
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    <Card className="bg-muted/35 shadow-none">
                      <CardHeader>
                        <CardDescription>Adaptive response</CardDescription>
                        <CardTitle>Explain, diagnose, adapt, continue.</CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-4 pt-0">
                        <div className="flex gap-3">
                          <span className="mt-2 size-2.5 shrink-0 rounded-full bg-blue-500 shadow-[0_0_0_6px_rgba(79,140,255,0.16)]" />
                          <div className="text-sm leading-7 text-muted-foreground">
                            Explain how <code className="rounded bg-background px-1 py-0.5 text-foreground">dependsOn: ["^build"]</code> propagates through the workspace graph.
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <span className="mt-2 size-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_6px_rgba(52,211,153,0.14)]" />
                          <div className="text-sm leading-7 text-muted-foreground">
                            Ask whether the blocker is pipeline semantics or package-output conventions.
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <span className="mt-2 size-2.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_0_6px_rgba(251,191,36,0.14)]" />
                          <div className="text-sm leading-7 text-muted-foreground">
                            Split the next frontier into a micro-step, then return to the original build path.
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        </section>

        <section id="features" className="flex flex-col gap-8 py-16">
          <div className="flex max-w-3xl flex-col gap-3">
            <Badge variant="outline" className="w-fit">
              What makes Construct different
            </Badge>
            <h2 className="max-w-3xl text-balance text-4xl font-medium leading-none tracking-[-0.07em] text-foreground sm:text-5xl">
              It feels good again to learn by building the real thing.
            </h2>
            <p className="max-w-3xl text-base leading-8 text-muted-foreground sm:text-lg">
              Construct is not a static tutorial and not AI vibe coding. It keeps
              the long-term architecture coherent while rewriting the short-term
              path around what you actually know, ask, struggle with, and ship.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {featureCards.map((feature, index) => {
              const Icon = feature.icon;

              return (
                <Card
                  key={feature.title}
                  className={`bg-card/88 backdrop-blur-xl ${
                    feature.wide ? "lg:col-span-2" : ""
                  }`}
                >
                  <CardContent className="flex h-full flex-col gap-5 p-5">
                    <feature.visual />
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="outline">{feature.badge}</Badge>
                        <Icon className="text-muted-foreground" />
                      </div>
                      <div className="flex flex-col gap-2">
                        <CardTitle>{feature.title}</CardTitle>
                        <CardDescription>{feature.description}</CardDescription>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section id="workflow" className="flex flex-col gap-8 py-12">
          <div className="flex max-w-3xl flex-col gap-3">
            <Badge variant="outline" className="w-fit">
              Workflow
            </Badge>
            <h2 className="text-balance text-4xl font-medium leading-none tracking-[-0.07em] text-foreground sm:text-5xl">
              From idea to runnable milestone without losing the plot.
            </h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            {workflowSteps.map((step, index) => (
              <Card key={step.title} className="bg-card/88 backdrop-blur-xl">
                <CardHeader className="gap-3">
                  <Badge variant="ghost" className="w-fit">
                    {(index + 1).toString().padStart(2, "0")}
                  </Badge>
                  <CardTitle>{step.title}</CardTitle>
                  <CardDescription>{step.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <section id="platform" className="flex flex-col gap-8 py-12">
          <div className="flex max-w-3xl flex-col gap-3">
            <Badge variant="outline" className="w-fit">
              Platform depth
            </Badge>
            <h2 className="text-balance text-4xl font-medium leading-none tracking-[-0.07em] text-foreground sm:text-5xl">
              The stack behind the experience is just as serious as the UI.
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {platformSignals.map((signal) => {
              const Icon = signal.icon;

              return (
                <Card key={signal.title} className="bg-card/88 backdrop-blur-xl">
                  <CardHeader className="gap-3">
                    <Icon className="text-muted-foreground" />
                    <CardTitle>{signal.title}</CardTitle>
                    <CardDescription>{signal.description}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="py-12">
          <Card className="overflow-hidden border-border/80 bg-card/88 backdrop-blur-xl">
            <CardContent className="grid gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-8">
              <div className="flex flex-col gap-4">
                <Badge variant="outline" className="w-fit">
                  Construct
                </Badge>
                <h2 className="max-w-3xl text-balance text-4xl font-medium leading-none tracking-[-0.07em] text-foreground sm:text-5xl">
                  For developers who still want learning to feel electric.
                </h2>
                <p className="max-w-2xl text-base leading-8 text-muted-foreground">
                  Move fast without giving up depth. Keep the repo, the commits, and
                  the understanding that vibe coding usually skips.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <a href="mailto:hello@tryconstruct.cc">
                    Request access
                    <SparklesIcon data-icon="inline-end" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <a href="#top">Back to top</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
