# Construct Reengineering Checklist

Date: 2026-06-15

## Goal

Turn Construct from a large prototype-shaped Electron app into a maintainable systems codebase with clear boundaries, observable AI/runtime behavior, OS-backed settings, and reusable Opaline UI primitives.

## Non-negotiables

- Keep existing app behavior working while moving code.
- Preserve current local data and migrate settings without deleting user state.
- Treat `app/src/main/index.ts` as an integration shell only; domain work belongs in modules.
- Keep `opaline` as a nested repo and package Opaline changes before Construct depends on them.
- Prefer explicit services, typed contracts, and small IPC handlers over broad utility bags.
- Log and trace agent calls with useful request/progress/result payloads.
- Do not put OpenTelemetry, OpenInference, or Phoenix complexity inside `fxpnt` yet.
- Do not use Vercel AI SDK, LangChain, or Mastra inside `fxpnt`.

## Current Hotspots

- `app/src/main/index.ts`: reduced from 2,570 lines to 251 lines. It now composes services/controllers, starts Electron, and owns only bootstrap-level wiring.
- `app/src/main/ipc/ConstructAgentIpcController.ts`: reduced from 489 lines to 53 lines. It is now a thin IPC adapter that resolves projects and delegates to AI services.
- `app/src/main/ai/ConstructVerifierService.ts`, `ConstructAuthoringReviewService.ts`, `ConstructSelectionExplainService.ts`, `ConstructCodeGhostService.ts`, and `ConstructLoggedAgentService.ts`: extracted from agent IPC so verifier/review/selection/ghost workflows have class-based service homes and shared structured logging hooks.
- `app/src/main/ipc/ConstructProjectIpcController.ts`: extracted project import/open/update/file/git/delete IPC boundary backed by project repository/workspace/git services.
- `app/src/main/lsp/ConstructLspService.ts`: extracted stateful language-server process subsystem from `index.ts`.
- `app/src/main/terminal/ConstructTerminalService.ts`: extracted PTY session lifecycle and terminal-output cache used by verifier/interact.
- `app/src/main/projects/*`: extracted project types, manifest repository, workspace materialization/safe file IO, git operations, and legacy data migration.
- `app/src/renderer/construct/components/Workspace.tsx`: reduced from 2,079 lines to 1,632 lines by extracting workspace-local UI components, Construct Interact progress-log buffering, path/tree helpers, knowledge derivation, git milestone state, edit guidance, and verifier-start logs. It still mixes navigation, file IO, editor state, dynamic steps, verification, terminal orchestration, and Construct Interact routing.
- `app/src/renderer/construct/lib/parser.ts`: 1,279 lines of runtime parsing/normalization that should be split into lexer/AST/normalizers/feature gates or moved closer to the compiler package.
- `app/src/renderer/construct/ConstructApplication.tsx`: reduced from 1,090 lines to 979 lines by extracting renderer log bridging and project LSP lifecycle into hooks. It still mixes project store orchestration, import/open flows, shell state, settings, and history.
- `app/src/renderer/construct/components/GuidePanel.tsx`: reduced from 1,058 lines to 649 lines. It now owns guide/block flow, while Construct Interact chat/tool/thinking mapping lives in `components/guide/ConstructInteractSession.tsx`.
- `app/src/renderer/construct/components/guide/ConstructInteractSession.tsx`: Construct-specific adapter over Opaline `AgentSessionSurface`; owns message shaping, pending progress, generated live-step previews, validation rows, and Construct action mapping. Generic timeline rows, thinking rows, actions, tool cards, tool groups, and dock primitives now live in Opaline.
- `app/src/renderer/construct/ConstructSettingsSurface.tsx`: reduced from 985 lines to 738 lines by extracting app AI/runtime/provider/model configuration and language-server settings into `components/settings/*`. It still mixes project settings/delete flow, workspace root changes, and settings persistence.
- `app/src/renderer/construct/components/settings/ConstructAiSettingsSection.tsx`: owns the live config UI for runtime, provider, API keys, provider base URLs, model catalog refresh, per-feature models, and save action.
- `app/src/renderer/construct/components/settings/ConstructLspSettingsPanel.tsx` and `lspSettingsModel.ts`: own language-server status modeling and settings UI, while lifecycle effects still live in the settings surface.
- `app/src/renderer/construct/components/EditorPane.tsx` and `app/src/renderer/construct/lib/lspClient.ts`: roughly 880 lines each; editor rendering, inline assistance, and LSP transport need clearer boundaries.
- `app/src/main/constructAgentRuntime.ts`: owns the runtime interface, configured runtime choice, Mastra multi-step structured generation, completion feedback, and observable iteration events; FXPNT remains the next runtime adapter.
- `app/src/main/config/constructConfig.ts`: now owns OS-backed `construct.config.json` reads/writes and migration from legacy `construct-projects/settings.json`; the next step is extracting project persistence and IPC registration away from `index.ts`.
- Tape compiler/parser now recognizes `tape-0.4.2`; generated live steps remain gated on `0.4.1+`, while formal agent-chosen resource discovery is gated on `0.4.2` and older `0.4.x` projects remain valid.

## Target Boundaries

- `main/app`: Electron app lifecycle, window creation, crash surfaces, and IPC registration.
- `main/infra`: logging, paths, files, subprocess helpers, model catalog clients, and telemetry bootstrap.
- `main/config`: OS-backed Construct settings/config loading, migrations, validation, and update APIs.
- `main/projects`: project manifest, workspace materialization, safe file operations, git operations, import/open/update/delete flows.
- `main/lsp`: language-server process lifecycle and IPC adapter.
- `main/terminal`: PTY session lifecycle, terminal output capture, and terminal IPC adapter.
- `main/learning`: learning state persistence and generated live-step persistence.
- `main/ai`: provider abstraction, model resolution, runtime registry, retry/error policy, observability hooks, base agent classes, Mastra runtime adapter, and future FXPNT adapter.
- `main/tape`: generated live-step validation and tape-version feature gates.
- `renderer/construct`: product orchestration that consumes typed bridge APIs.
- `opaline/packages/ui`: reusable shell, settings, agent chat, thinking, tool-call, action, and dock components.

## Migration Order

1. Write this checklist and keep it updated as decisions change.
2. Extract low-risk main-process infrastructure first: logging, paths/settings, project repository/workspace service, terminal service, LSP service, and window lifecycle.
3. Replace split settings reads with one OS-backed config service and keep old settings paths as migration inputs.
4. Move project, settings, learning, terminal, LSP, debug, and agent IPC registration into small registrar classes so `index.ts` only composes systems.
5. Move AI into a real module with typed providers, model selection, runtime registry, retries, structured errors, and tracing hooks.
6. Re-home Construct Interact on the AI module and preserve existing output/action semantics.
7. Add `tape-0.4.1` support and move generated dynamic steps/routing to that capability gate while keeping `tape-0.4` Interact valid.
8. Add `tape-0.4.2` source provenance, concept engagement, and agent-chosen tool discovery without imposing a runtime tool sequence.
9. Create the public `fxpnt` repo with a small low-level runtime API and wire Construct settings to expose `Mastra` and `FXPNT`.
10. Study opencode agent UI patterns, build reusable Opaline agent chat/tool/thinking components, and wire Construct to them. A first reusable Opaline primitive split is in place; the deeper opencode-specific port is deferred to the next pass per user direction on 2026-06-14.
11. Split renderer dump files after the main-process seam exists: `Workspace.tsx`, `ConstructApplication.tsx`, `GuidePanel.tsx`, settings, editor, and LSP client.
12. Verify with focused tests during refactors, then full `pnpm verify` before packaging PRs.

## Decisions Logged

- Main bootstrap now follows a controller/service composition shape: `index.ts` wires app, logging, windows, config, projects, terminal, LSP, learning, settings, and agent IPC.
- Stateful infrastructure is class-based: `ConstructLspService`, `ConstructTerminalService`, `ProcessInspector`, `ConstructWindowManager`, `MainProcessLogBridge`, `LegacyProjectDataMigrator`.
- Project domain is no longer defined in the Electron entrypoint; project shape lives in `ConstructProjectTypes`, persistence in `ConstructProjectRepository`, workspace operations in `ConstructProjectWorkspaceService`, and git operations in `ConstructProjectGitService`.
- Construct Interact moved into `ConstructInteractService`, which owns timeout/recovery, agent-selected tool wiring, tape `0.4.1` live-step gating, `0.4.2` provenance/resource behavior, live-step validation, concept engagement, learning-state writes, and structured agent logging.
- Agent IPC no longer owns agent behavior. It delegates to dedicated AI services, and those services inherit from `ConstructLoggedAgentService` so OpenTelemetry/OpenInference hooks can land at the service/runtime layer instead of being sprinkled across handlers.
- Construct-side observability is centralized in `ConstructObservabilityService`, which uses `@arizeai/phoenix-otel` when enabled in Construct config. Phoenix/OpenInference setup stays in Construct; `fxpnt` remains a low-level runtime without tracing complexity.
- IPC registration is split by subsystem: LSP, terminal, system/dialogs, settings, learning, project/workspace, and agent commands.
- Renderer workspace splitting started: `FileChooserContent` and `LiveStepPanel` moved out of `Workspace.tsx` into `components/workspace/*`, shared file icon rendering moved with the chooser module, and Construct Interact progress-log buffering moved into `useInteractProgressLogBuffer`.
- Workspace pure logic is no longer buried below the component: `workspacePaths`, `workspaceTree`, `workspaceKnowledge`, `gitMilestoneState`, `editGuidance`, and `verificationLogSeed` own focused helper domains.
- Guide panel splitting started: Construct Interact chat rendering moved into `ConstructInteractSession`, leaving the guide shell to route blocks and verification UI.
- Opaline agent-session primitives are now split into public type, timeline, and primitive modules. Construct can use reusable thinking rows, tool cards, tool groups, action rows, and dock surfaces without owning generic chat rendering.
- Construct Interact activity rows now represent only recorded Mastra tool calls; deterministic request/wait/validation lifecycle events are not presented as agent-chosen steps.
- Construct Interact now uses Mastra's native bounded multi-step loop with the configured model supplied to structured output, allowing tool use and typed final output in one run.
- Agent iteration summaries and exact tool-call records are persisted per turn and rendered through the reusable Opaline `AgentRunTrace`; private chain-of-thought is not exposed.
- Concept engagement persists introduced/opened/saved state independently, including unsaved card opens and first/last-open timestamps.
- Settings splitting started: AI runtime/provider/model UI moved into `ConstructAiSettingsSection`, and language-server settings moved into `ConstructLspSettingsPanel` plus `lspSettingsModel`. Persistence remains in the surface until the settings controller hook is extracted.
- Verification after renderer/settings extractions: `pnpm --filter @construct/app typecheck` passes, and `pnpm --filter @construct/app test` passes with 52/52 tests.
- Verification after Workspace helper extraction: `pnpm --filter @construct/app typecheck` passes.
- Renderer application global effects are now hooks: `useConstructLogBridge` owns LSP/main/agent log subscriptions, and `useProjectLspLifecycle` owns project LSP start/stop/focus refresh behavior.
- Verification after ConstructApplication hook extraction: `pnpm --filter @construct/app typecheck` passes, and `pnpm --filter @construct/app test` passes with 52/52 tests.
- Verification after the extraction: `pnpm --filter @construct/app typecheck` passes, and `pnpm --filter @construct/app test` passes with 52/52 tests.
- Verification after observability and Opaline agent-session primitive split: `npm run typecheck -w @opaline/ui`, `npm run build -w @opaline/ui`, `pnpm --filter @construct/app typecheck`, and `pnpm --filter @construct/app test` pass with 52/52 tests.
- Verification after tape 0.4.2 provenance, engagement, and Interact UI work: app typecheck, Opaline UI typecheck/build, and 64/64 focused app tests pass.
- Verification after the full agent loop and durable activity trace: the live OpenRouter ABI scenario completed six Mastra steps, used authored-step/resource/learner/concept tools, preserved source provenance, and returned an unopened-concept action. App tests pass 67/67.

## Commit Shape

Construct `0.2.0` packaging uses dependency-first release commits:

1. Commit and push the reusable Opaline agent-session primitives.
2. Commit and push the Construct runtime, tape, provider, UI, tests, documentation, and exact Opaline pointer.
3. Tag the verified Construct commit and let the GitHub release matrix package macOS, Windows, and Linux assets.

## Open Checks

- Confirm whether any current dirty files are user edits before overwriting nearby code.
- Confirm exact current app config path on macOS via Electron `app.getPath("userData")`; use a stable Construct config file below that path.
- `fxpnt` public repo created at https://github.com/AbhinavMishra32/fxpnt with seed commit `23e6b4e`.
- Deeper opencode UI source port is explicitly deferred; revisit `/tmp/construct-opencode-reference/packages/app/src` or reclone `https://github.com/anomalyco/opencode/tree/dev/packages/app/src` when resuming.
- Re-run parser/compiler tests after every tape grammar change.
