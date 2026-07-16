# Compiled thread application

This directory contains the production-compiled thread UI used by Construct's Flow chat. It is mounted inside `AsideConstructThread.tsx` so its original React tree, contexts, animations, composer, message rendering, and tool-call rendering stay intact.

Construct owns the runtime behind that UI:

- `construct-runtime-shim.js` maps the compiled application's HTTP and WebSocket daemon protocol to a parent-window message channel.
- `AsideConstructThread.tsx` answers that protocol with Construct sessions, settings, models, and the existing `onRunAgent` path.
- `asideThreadProtocol.ts` projects persisted and live Construct Flow sessions into the message and streaming-event envelopes expected by the compiled UI.
- `assets/tool-renderer-Bj91yJjw.js` registers Construct concept, practice-task, and concept-exercise renderers in the compiled tool registry.
- `assets/schemas-EgjOPK4R.js` resolves lazy assets under `/aside-thread/assets/` so Vite and the packaged application serve the same URLs.

The compatibility styles in `../assets/` cover cached root-level lazy-style requests emitted by older copies of the compiled preload helper.
