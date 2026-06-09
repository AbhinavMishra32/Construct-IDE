# Opaline UI workflow

Construct consumes Opaline through the local workspace package `@opaline/ui`.
Opaline lives in the `opaline` submodule and remains a standalone publishable
npm package.

When changing Construct UI, first check whether the desired behavior belongs in
Opaline as a generic component improvement. Prefer adding reusable primitives,
layout props, visual tokens, or composition hooks in `opaline/packages/ui`, then
consume those APIs from Construct. Keep Construct-specific workflows, copy, data
loading, and tape state in Construct.

Local development does not require publishing. Construct's pnpm workspace
includes `opaline/packages/*`, and `@construct/app` depends on
`@opaline/ui` via `workspace:*`, so changes to Opaline source can be built and
typechecked locally before package publication.
