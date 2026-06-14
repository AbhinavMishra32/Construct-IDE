# Construct Tape Changelog

This is the canonical compatibility history for the Construct tape protocol. New runtimes must continue to parse and run older listed revisions.

## tape-0.4.2

- Formalizes agentic Construct Interact. The runtime gives the agent project and block identity plus the learner message; the agent chooses whether and which scoped tools to call.
- Adds provenance-labelled authored-step, authored-block, concept-card, reference-card, workspace-file, learner-history, and concept-engagement tool results.
- Extends `::resources` with `steps`, `concepts`, `references`, and `files` discovery hints. Resource ids are not preloaded evidence and do not impose a tool order.
- Tracks concept `introduced`, `opened`, and `saved` state independently, including open count and first/last-open timestamps for unsaved concepts.
- Requires source-accurate replies: wording from concept and reference cards must not be attributed to lesson steps.
- Runs Construct Interact as a bounded Mastra agent loop. The agent completes inspection and tool use in the same run instead of returning a promise to check later.
- Persists each turn's model-iteration summaries, actual tool calls, bounded inputs/results, and duration so the activity trace remains available after reload.
- Adds real concept actions beside lesson content and a Codex-style Interact thread, expandable activity trace, actions, and composer.

## tape-0.4.1

- Adds generated live learning steps and their validation/provenance records.
- Allows Construct Interact to propose small explain, interact, or reply-recall remediation without mutating authored tape source.
- Keeps all `tape-0.4` projects valid.

## tape-0.4

- Adds Construct Interact understanding checks and reply-mode recall.
- Adds local-first learner memory, assistance history, concept understanding, and Knowledge Base records.
- Deprecates new legacy `guide.*` authoring while retaining parser compatibility.

## Compatibility Policy

- `tape-0.4`, `tape-0.4.1`, and `tape-0.4.2` all run through the current Construct Interact service.
- Older 0.4 revisions receive the safer agentic/source-aware runtime behavior without requiring source rewrites.
- Revision feature gates only enable additive outputs such as generated live steps or formal 0.4.2 resource discovery.
