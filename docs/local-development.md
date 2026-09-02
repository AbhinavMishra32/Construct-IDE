# Running Construct locally

Three things have to be up: a Postgres, the cloud backend, and the desktop app.

## 1. Postgres

The backend needs Postgres. Any instance will do; this one is dedicated to
Construct so it cannot collide with another project's database:

```bash
docker run -d --name construct-pg-dev \
  -e POSTGRES_USER=construct \
  -e POSTGRES_PASSWORD=construct \
  -e POSTGRES_DB=construct_cloud \
  -p 5433:5432 postgres:16-alpine
```

Port 5433 rather than 5432, because 5432 is usually already taken.

Once created, it is started again with `docker start construct-pg-dev`.

## 2. Cloud backend

Lives in its own repository, checked out at `private/construct-cloud-backend`.

```bash
cd private/construct-cloud-backend
cp .env.example .env
```

Three values in `.env` matter for local work:

| Key | Value | Why |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://construct:construct@localhost:5433/construct_cloud` | The container above |
| `BETTER_AUTH_SECRET` | any long random string | Better Auth refuses to start without one |
| `CORS_ORIGINS` | must include `construct://desktop` | Better Auth reads its `trustedOrigins` from this, and rejects every desktop request whose Origin is not listed |

That last one is the non-obvious one. The desktop sends `construct://desktop` as
its Origin because Node's fetch stamps `sec-fetch-mode: cors` on every request,
which Better Auth reads as a browser calling — and it refuses a browser request
that arrives with no Origin. The scheme is deliberately not http: nothing can
serve a page from it, so the value cannot be forged by one.

Then migrate and run. The backend does not load dotenv itself, so the env file
is passed to Node:

```bash
pnpm exec tsx --env-file=.env src/db/migrate.ts
pnpm exec tsx --env-file=.env src/index.ts
```

It listens on **8787**, which is what the desktop's `DEV_API_ORIGIN` points at.
Override with `CONSTRUCT_API_ORIGIN` to run against something else.

## 3. Desktop app

```bash
pnpm install
pnpm --filter @construct/domain build
pnpm dev
```

`pnpm dev` runs Vite, the main-process build, and Electron together. The
renderer wants port **5173**; if something else holds it, Vite exits and takes
the whole command with it.

## Signing in

Email and password only. Construct's backend runs Better Auth without the
`emailOTP` plugin, so the emailed-code flows the sign-in window draws are
refused by name until that plugin is added. Sign-up creates the account and
signs the device in immediately.

The session is stored in the OS keychain under `cc.construct.desktop` and is
presented on later requests as a **cookie** — Better Auth reads nothing else
without its `bearer` plugin loaded.
