# CI/CD Pipeline Design — @telekosmos/anythingllm-mcp-server

**Date:** 2026-08-25
**Status:** Approved by user

## Context

The repo is an ESM Node.js MCP (Model Context Protocol) stdio server (`node >=18`) with a
`bin` entry (`anythingllm-mcp-server` -> `src/index.js`). There is currently no test suite,
no `test` script, and no CI besides `sync-upstream.yml`. Publishing is manual via interactive
shell scripts (`scripts/publish.sh`, `scripts/quick-publish.sh`).

Goal: agents should be able to run the fixed fork via `npx`. The npm name
`anythingllm-mcp-server` is already owned by the buggy upstream (`raqueljezweb`), so this fork
publishes under the scoped name **`@telekosmos/anythingllm-mcp-server`** (verified available).

## Decisions (user-approved)

1. **Test runner:** Node's built-in `node --test` runner. Simplest option; zero new dependencies.
2. **Publish trigger:** on push of a `v*` git tag. CI publishes automatically.
3. **Lockfile:** commit `package-lock.json`; CI installs with `npm ci` for reproducibility.
4. **npm package name:** `@telekosmos/anythingllm-mcp-server`.

## Workflows

### `.github/workflows/ci.yml` — test + build on every merge

- Triggers: `pull_request` (all branches) and `push` to `main`.
- Steps:
  1. Checkout repo.
  2. Setup Node (matrix: `18.x`, `20.x`, `22.x`) with npm cache.
  3. `npm ci`.
  4. `npm test`.
  5. `npm pack --dry-run` — the "build" step: verify the npm tarball is complete
     (includes `src/`, `bin`, README, LICENSE).

### `.github/workflows/publish.yml` — publish to npm

- Triggers: `push` of tag matching `v*`.
- `concurrency`: guard so two tags cannot publish simultaneously.
- Steps:
  1. Checkout repo.
  2. Setup Node `20.x` with npm cache.
  3. `npm ci`.
  4. `npm test`.
  5. **Version guard:** fail if `package.json` version != tag with leading `v` stripped
     (prevents mismatched or duplicate-version publishes).
  6. `npm pack --dry-run`.
  7. `npm publish` with `NODE_AUTH_TOKEN` = `${{ secrets.NPM_TOKEN }}` via a repo-root
     `.npmrc` pointing at `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`.

## Repo / tooling changes

- **`.gitignore`:** remove the `package-lock.json` line; regenerate and commit the lockfile.
- **`package.json`:**
  - `name` -> `@telekosmos/anythingllm-mcp-server`.
  - Add `"files": ["src/"]` (ship only runtime code plus README/LICENSE/package.json).
  - Add `"publishConfig": { "access": "public" }` (required for scoped npm packages).
  - Add `"test": "node --test"` (bare default discovery; passing a directory arg like
    `node --test test/` fails on Node 22 and glob-script forms are fragile across versions).
  - `bin` unchanged (`anythingllm-mcp-server`).
- **`src/index.js`:** add the standard ESM direct-execution guard:
  only call `main()` when the file is launched directly (`import.meta.url ===
  pathToFileURL(process.argv[1]).href`); export `validateBaseUrl` so unit tests can import it
  without booting the server.

## Tests (`test/`)

- `test/boot.test.js` — **stdio smoke test.** Spawn `node src/index.js` as a subprocess, perform
  an MCP `initialize` + `tools/list` JSON-RPC handshake over stdio, assert all 13 expected tool
  names are registered. Proves an agent can connect via `npx`.
- `test/url.test.js` — unit tests for `validateBaseUrl` (accepts http/https, strips trailing
  slash, rejects other protocols, rejects embedded credentials, rejects invalid URLs).
- `test/path.test.js` — unit tests for `safePathSegment` (URL-encodes special characters,
  throws on null/undefined, throws on empty string).

## Release flow (replaces manual scripts)

1. `npm version patch|minor|major` — commits a version bump and creates a `vX.Y.Z` tag.
2. `git push && git push --tags`.
3. CI runs tests + build, then publishes `@telekosmos/anythingllm-mcp-server`.
4. `scripts/publish.sh` / `scripts/quick-publish.sh` become obsolete; left in place.

## Operational requirements

- **Secret:** add an npm **automation token** (publish scope) to the GitHub repo as
  `NPM_TOKEN`.
- **README:** document `npx @telekosmos/anythingllm-mcp-server` usage for MCP clients, the
  new release flow, and the `NPM_TOKEN` secret requirement.

## Out of scope

- Releasing the upstream name `anythingllm-mcp-server` (not owned by this repo).
- Migration of `scripts/publish.sh` / `quick-publish.sh` (kept as-is).
- Code coverage tooling.
