# Construct Hosted Compute Architecture

Construct stays open source by default. Local BYOK mode remains the normal path: users bring their own OpenAI, OpenRouter, OpenCode Zen, GitHub Copilot, or LiteLLM credentials and the desktop app calls those providers directly from the user's machine.

Hosted Compute is the account-backed model path. When a user chooses Hosted Compute in AI settings, the desktop app sends OpenAI-compatible model calls to a hosted backend instead of using local API keys. That backend owns provider keys, account login, subscriptions, and usage accounting.

## Private Backend Boundary

The backend source lives in the private GitHub repo:

```text
https://github.com/AbhinavMishra32/construct-cloud-backend
```

This public repository tracks it only as a submodule at:

```text
private/construct-cloud-backend
```

Public clones can build Construct without the private submodule. Maintainers with access can initialize it with:

```bash
git submodule update --init private/construct-cloud-backend
pnpm --filter @construct/cloud-backend dev
```

The root workspace includes `private/*` so Turbo and pnpm see the backend when the submodule is present. The backend code and server-owned LLM keys are never committed into the public Construct repo.

## Auth And Plans

The private backend uses Better Auth with:

- Email/password login.
- Google OAuth.
- GitHub OAuth.
- Postgres/Neon persistence.
- A `plan` field on the Better Auth `user` table with `free` and `pro` values.

Razorpay can later update `user.plan`. Until then, maintainers can switch a user manually in Postgres and the usage limits change automatically.

From a checkout with the private submodule initialized:

```bash
pnpm --dir private/construct-cloud-backend admin:set-plan user@example.com pro
pnpm --dir private/construct-cloud-backend admin:set-plan user@example.com free
```

The helper only needs `DATABASE_URL`, so operators can change plans without exposing provider keys on the machine doing the admin work.

## Agentic Usage Limits

Modern agent tools expose overlapping usage meters instead of a simple request count: a five-hour session window plus a longer weekly cap. Hosted Compute mirrors that shape.

The backend records usage as compute seconds:

- A request reserves estimated compute before the provider call.
- The final charge is adjusted from elapsed time and provider token usage when available.
- Both the five-hour window and weekly window are checked before the request starts.
- Free and Pro limits are environment-configurable.

Default limits in the private backend:

- Free: 18,000 compute seconds per five-hour window and 72,000 per week.
- Pro: 90,000 compute seconds per five-hour window and 360,000 per week.

## Public App Contract

The desktop app should only know:

- Hosted Compute base URL.
- A desktop bearer token minted after account login.
- Which Hosted Compute model to request.

All provider routing, server-owned API keys, plan checks, usage windows, and future billing enforcement stay behind the backend.
