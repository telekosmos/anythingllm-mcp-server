# Docker Image + SSE Transport Design

Date: 2026-08-28

## Goal

Make this stdio-only MCP server usable in a multi-container docker-compose
environment (alongside an AnythingLLM server and a Hermes MCP client) by:

1. Adding an HTTP/SSE transport (env-gated, stdio stays the default).
2. Adding a `Dockerfile` (multi-stage, `node:22-alpine`) and `.dockerignore`.
3. Adding npm scripts to build/run the image.
4. Providing an example `docker-compose.yml`.

Out of scope: GitHub Actions changes, README rewrite.

## 1. Transport code (`src/index.js`)

Non-breaking: stdio remains the default transport.

- New env vars:
  - `MCP_TRANSPORT` — `stdio` (default) or `http`.
  - `MCP_HOST` — bind host for HTTP mode (default `0.0.0.0`).
  - `MCP_PORT` — listen port for HTTP mode (default `4001`).
- `main()` selects the transport:
  - stdio: existing `StdioServerTransport`.
  - http: Node built-in `http` server:
    - `GET /sse` → new `SSEServerTransport('/messages', res)`, stored in a
      `Map<sessionId, transport>`; connects the existing MCP `server`.
      On close, removes the session from the map.
    - `POST /messages` → route by `?sessionId=` query param; call
      `transport.handlePostMessage(req, res)` (SDK reads the request body).
    - Anything else → 404.
- Logs only to stderr (preserves stdio cleanliness).
- No new dependencies: uses Node's `node:http` and the SDK's
  `SSEServerTransport` (SDK already bundles body parsing via `raw-body`).
- Extract a pure `resolveTransportConfig(env)` helper returning
  `{ mode, host, port }` so the parsing is unit-testable. Unknown `MCP_TRANSPORT`
  values throw a clear error (fail fast); `stdio` is used only for the explicit
  default or when the var is unset.

## 2. Dockerfile

Multi-stage build on `node:22-alpine`:

- Stage `deps`: copy `package.json` + `package-lock.json`, run `npm ci`.
- Stage `runtime`: copy `node_modules/` and `src/` from deps; set env defaults
  (`MCP_TRANSPORT=stdio`, `MCP_HOST=0.0.0.0`, `MCP_PORT=4001`,
  `ANYTHINGLLM_BASE_URL=http://localhost:3001`); `EXPOSE 4001`;
  `USER node` (non-root); `ENTRYPOINT ["node", "src/index.js"]`.

`.dockerignore` keeps the build context lean (exclude `node_modules/`, `.git/`,
`__IGNORE__/`, `.npmrc`, `.env*`, `docs/`, `test/`, `scripts/`, etc.).

## 3. npm scripts (`package.json`)

- `docker:build` — build image tagged `anythingllm-mcp-server:<version>` and
  `anythingllm-mcp-server:latest`.
- `docker:run` — convenience helper: run the image in HTTP mode against
  `http://localhost:3001`, exposing port 4001.

## 4. Example compose (`examples/docker-compose.yml`)

Three services:

- `anythingllm` — `mintplexlabs/anythingllm`, exposes 3001, persistent volume,
  requires `JWT_SECRET`, `SIG_KEY`, `STORAGE_DIR`.
- `anythingllm-mcp` — built from this repo, `MCP_TRANSPORT=http`,
  `ANYTHINGLLM_BASE_URL=http://anythingllm:3001`, `ANYTHINGLLM_API_KEY` via env,
  exposes 4001.
- `hermes` — placeholder image for the MCP client; shows how it points at
  `http://anythingllm-mcp:4001/sse`.

Header comments explain the wiring.

## 5. Tests

- Unit: `resolveTransportConfig` — default (stdio), http mode, custom host/port,
  invalid `MCP_TRANSPORT` value throws.
- Integration: spawn the server with `MCP_TRANSPORT=http` on an ephemeral port,
  perform an SSE `initialize` + `tools/list` handshake, assert all 38 expected
  tools, then shut down.
