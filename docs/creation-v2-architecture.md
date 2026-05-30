# Construct Creation V2

This document describes a simpler project-creation architecture for Construct.

The current creation stack asks one LLM workflow to act as:

- artifact interpreter
- course designer
- project planner
- blueprint generator
- learner-mask author
- lesson writer
- repair loop

That coupling makes the system brittle. When one stage drifts, later stages amplify the drift instead of containing it.

## Main Problems

### 1. Artifact drift

The system can quietly replace the requested artifact with a tutorial-friendly surrogate.

Examples:

- user asks for a framework/runtime/system
- Construct generates a demo app about that framework instead

This is the highest-severity failure because every later lesson and task may be "well structured" but still be about the wrong thing.

### 2. Pedagogy is shaping architecture

The current pipeline decides how to teach before it has reliably decided what to build.

That creates behaviors like:

- shrinking complex requests into tiny toy slices
- biasing toward tutorial-first framing when the user wanted implementation-first
- generating steps that are internally neat but externally unfaithful

### 3. Repair loops operate on unstable semantics

The current repair path often tries to patch:

- prompt drift
- artifact drift
- step-budget violations
- masking bugs

using more generation passes. That makes failures recursive instead of local.

### 4. Lessons and project generation are too entangled

The system currently generates:

- project identity
- step structure
- learner-facing code gaps
- authored teaching

in one tightly coupled flow.

That means style problems can mutate project structure, and project structure problems can force ugly lesson behavior.

## Design Goals

Creation V2 should optimize for:

1. artifact fidelity
2. deterministic structure where possible
3. style layered on top of structure
4. local failure surfaces
5. fewer cross-stage repair loops

## Proposed Pipeline

Creation V2 should follow this order:

```txt
ArtifactSpec
-> ProjectSpec
-> SolvedProject
-> StepPlan
-> LearnerDiff
-> Lesson
```

Each stage has a narrow responsibility.

### 1. ArtifactSpec

Question:

```txt
What is the thing the user wants built?
```

Outputs:

- artifact label
- artifact kind
- build substrate
- ambiguity flag
- optional clarification question

Rules:

- do not invent pedagogy here
- do not decide step count here
- do not replace the artifact here
- if ambiguous, ask one clarification or record a bounded interpretation

Examples:

- "implement reactjs from scratch in typescript"
  - likely ambiguous between:
    - React-like runtime/framework
    - React app without scaffolding
    - guided learning project about React internals
- "build a NestJS backend for research agents"
  - artifact is clear

### 2. ProjectSpec

Question:

```txt
What modules, files, and capabilities define the finished artifact?
```

Outputs:

- canonical module graph
- major capabilities
- storage/runtime boundaries
- entrypoints
- dependency order

Rules:

- this is still artifact design, not lesson writing
- no learner masking yet
- no tiny-step decomposition yet

### 3. SolvedProject

Question:

```txt
What does the finished project look like in runnable form?
```

Outputs:

- support files
- solved implementation files
- hidden validation seams

Rules:

- artifact-faithful
- boring is good
- no teaching style concerns here

### 4. StepPlan

Question:

```txt
How do we cut the solved project into dependency-ordered visible milestones?
```

Outputs:

- ordered steps
- each step owns a concrete boundary
- each step references solved files/modules

Rules:

- deterministic slicing beats creative slicing
- prefer "real subsystem milestone" over "cute tutorial moment"
- do not alter artifact identity

### 5. LearnerDiff

Question:

```txt
What exact learner-owned gap is exposed in the current step window?
```

Outputs:

- learner-visible incomplete files
- anchors
- step-local hidden tests

Rules:

- mechanical masking where possible
- one local unfinished boundary per intro step
- no future artifact invention

### 6. Lesson

Question:

```txt
How do we teach this exact step well?
```

Outputs:

- lesson slides
- implementation handoff
- checks

Rules:

- may explain the project arc
- may use working support code as context
- may teach warmly and concretely
- may not mutate artifact identity
- may not rewrite step ownership

## Core Invariants

These should hold across the entire pipeline:

### Invariant A: artifact lock

Once `ArtifactSpec` is accepted, later stages may not substitute:

- a different app
- a different domain
- a more tutorial-friendly showcase artifact

without explicit user confirmation.

### Invariant B: teaching cannot redesign the project

Lesson authoring may explain:

- why the project is shaped this way
- how the current code boundary works

but it may not redefine the artifact or invent a different one.

### Invariant C: adaptation changes pacing, not identity

When the learner struggles, Construct may:

- narrow the next diff
- deepen explanation
- add another checkpoint

but it should not switch to a different project identity.

### Invariant D: repair is local

Repair should happen at the failing layer:

- malformed lesson -> regenerate lesson
- bad learner diff -> rebuild learner diff
- artifact ambiguity -> clarify artifact

not "rerun everything and hope."

## Migration Plan

### Phase 1: introduce V2 contracts

Add explicit code-level contracts for:

- artifact lock
- creation stage order
- artifact clarification rules

No behavior change required yet.

### Phase 2: split current creation flow conceptually

Refactor the current runner flow into separately named internal stages:

- artifact resolution
- project spec generation
- solved project generation
- step slicing
- learner masking
- lesson authoring

The implementation can still share code internally at first.

### Phase 3: stop lesson generation from owning project shape

Make lesson authoring consume a fixed step contract instead of shaping the plan.

### Phase 4: simplify repair loops

Replace generic full-pipeline repair retries with layer-specific repairs.

### Phase 5: move step slicing toward deterministic transforms

Where possible:

- diff solved project files
- compute learner-visible gaps
- derive step-local test surface

instead of asking one LLM to invent the whole exercise surface.

## What Success Looks Like

A good v2 creation flow should:

- ask one clarification when the artifact is truly ambiguous
- stay loyal to the requested artifact afterward
- generate fewer but more meaningful failure classes
- teach in a more human, practical style
- break less often because fewer stages are creatively overreaching

The system should feel like:

```txt
lock the build
generate the real project
expose the next diff
teach that diff well
adapt pacing without changing identity
```

## Live Kernel Migration

The runner now has a deterministic creation kernel in
`runner/src/creationKernel.ts`.

The live flow is:

```txt
goal
-> artifact lock
-> deterministic scope
-> deterministic build-control intake
-> model plan inside creation contract
-> model project bundle inside creation contract
-> model lesson inside creation contract
```

This deliberately removes several unstable early decisions from the model. The
model no longer decides whether to ask broad intake questions, whether to run
local research, or what the creation architecture is. It receives a creation
contract and generates inside it.

The key product rule is:

```txt
The solved project is the source of truth.
Teaching, repair, pacing, and adaptation sit on top of that project.
```

The existing API still returns planning sessions and answers so the desktop app
does not need a breaking protocol migration yet, but those "questions" are now
small build controls rather than model-authored quizzes or course-personality
surveys.
