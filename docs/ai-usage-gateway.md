# AI Usage Gateway

Construct AI calls are routed through a central gateway boundary.

Desktop BYOK requests use `app/src/main/ai/AIGateway.ts` and call the selected provider directly from the desktop process. Hosted compute requests also pass through that desktop gateway, but the resolved provider endpoint is the Construct Cloud `/v1` API.

Construct Cloud hosted compute uses `private/construct-cloud-backend/src/aiGateway.ts` as the only provider-calling module. The backend gateway:

- estimates `usageUnits` before provider calls
- atomically reserves units against active quota windows
- denies quota failures with reset metadata
- calls the provider
- commits final units from actual token usage when available
- refunds failed or over-reserved calls
- writes append-only usage ledger and audit events
- records structured metrics and logs without raw prompts, images, secrets, or full provider payloads

Active quota windows are:

- `five_hour_all`
- `weekly_all`
- `weekly_expensive` when the plan enables expensive-model units

The debug endpoint `/api/cloud/usage/debug` returns quota windows, recent reservations, ledger events, audit events, and in-memory metrics so an allow or deny decision can be inspected without exposing raw model payloads.
