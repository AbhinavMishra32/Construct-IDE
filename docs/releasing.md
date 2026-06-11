# Releasing Construct

Construct desktop releases are command-based. There is no GitHub Actions workflow in this repo.

## Prerequisites

- `pnpm install`
- `gh auth login -h github.com`
- macOS runner for mac artifacts
- Windows runner for windows artifacts
- Linux runner for linux artifacts

## Version

The current release line is `0.0.3`.

## Refresh brand assets

When the app icon changes, regenerate the packaged icons on macOS:

```bash
pnpm brand:icons
```

This writes:

- `app/build/icons/icon.icns`
- `app/build/icons/icon.ico`
- `app/build/icons/icon.png`
- `app/build/icons/png/*`

## Build release artifacts

Run these on the matching operating system:

```bash
pnpm verify
pnpm release:mac
```

```bash
pnpm verify
pnpm release:win
```

```bash
pnpm verify
pnpm release:linux
```

Artifacts are written to:

```text
app/release/0.0.3/
```

## Publish to GitHub

After artifacts are available, upload them with:

```bash
pnpm release:publish
```

The publish script:

- checks `gh` auth
- creates `v0.0.3` if it does not exist
- uses `docs/releases/0.0.3.md`
- uploads every artifact from `app/release/0.0.3/`
