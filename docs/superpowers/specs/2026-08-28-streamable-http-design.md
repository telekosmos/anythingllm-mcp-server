# Streamable HTTP Transport + Tool Wiring Tests Design

Date: 2026-08-28

## Goal

Match the latest MCP transport standard by adding a Streamable HTTP transport
alongside the existing stdio and SSE (`http`) transports, and add tests that
verify the 25 previously-undocumented tools register and wire up correctly.

Out of scope: GitHub Actions changes, modifying existing tests (additions only).

## 1. Transport code (`src/index.js`)

Non-breaking: stdio and SSE (`http`) remain unchanged. `streamable-http` is a
new, third value for `MCP_TRANSPORT`.

- `resolveTransportConfig`: accept `streamable-http` as a valid mode. Existing
  validation (host default `0.0.0.0`, port default `4001`, integer 1-65535,
  unknown mode throws) is unchanged.
- New `startStreamableHttpTransport(config)`: Node built-in `http` server on
  `config.host`/`config.port`, single endpoint `/mcp`:
  - Request with an `mcp-session-id` header → look up the session in a
    `Map<sessionId, transport>` and call `transport.handleRequest(req, res)`;
    unknown session id → 404.
  - Request without a session id → create a new
    `StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: () => sessions.set(transport.sessionId, transport) })`,
    wire `transport.onclose` to delete the session, create a fresh
    `createMcpServer()` and `await server.connect(transport)` (per-session
    `Server`, same pattern as SSE — the SDK allows one `Protocol` per
    transport), then `await transport.handleRequest(req, res)`.
  - Any other path → 404. Errors logged to stderr; 500 response only if
    headers not yet sent.
  - On listen, logs
    `AnythingLLM MCP Server (Streamable HTTP) listening on http://<host>:<port>/mcp`.
- `main()`: add `else if (transportConfig.mode === 'streamable-http')` branch
  calling `startStreamableHttpTransport(transportConfig)`.
- No new dependencies: `StreamableHTTPServerTransport` and its `@hono/node-server`
  adapter are already bundled by `@modelcontextprotocol/sdk`.

## 2. Tests

- `test/transport.test.js`: add unit cases — `streamable-http` is a valid mode
  with default host/port; the existing invalid-mode/port tests still hold.
- `test/streamable-http.test.js` (new): integration tests mirroring
  `test/sse.test.js` — spawn `src/index.js` with
  `MCP_TRANSPORT=streamable-http`, `MCP_HOST=127.0.0.1`, `MCP_PORT=<free port>`,
  connect with the SDK `Client` + `StreamableHTTPClientTransport` at
  `http://127.0.0.1:<port>/mcp`, assert `tools/list` returns 38 tools, plus a
  concurrent two-session test.
- `test/additional-tools.test.js` (new): mock-client unit tests for
  `handleAdditionalTools` covering all 27 additional tools (which include the 23
  newly-documented ones): each maps to the correct `client` method with the
  correct arguments; an unknown tool name returns `null`.
- Core-tool dispatch: the two core newly-documented tools
  (`get_system_settings`, `update_system_settings`) are dispatched by the
  `CallToolRequestSchema` handler in `src/index.js`, not by
  `handleAdditionalTools`. Their registration is covered by the 38-tool
  assertions; their wiring is covered by a dispatch assertion in the
  streamable-http integration test: calling them returns a backend-connection
  error (AnythingLLM not running in tests), never `Unknown tool`.

## 3. Documentation

- `README.md`: `MCP_TRANSPORT` row in the env table gains `streamable-http`
  (`stdio` | `http` (SSE) | `streamable-http`). Add a short "Streamable HTTP
  mode" note: endpoint `http://<host>:4001/mcp`, and a client config example
  using `"type": "http"`. Note SSE (`http`) remains available.
- `examples/docker-compose.yml`: add a header note that `streamable-http` is a
  drop-in alternative (`MCP_TRANSPORT=streamable-http`, endpoint `/mcp`). The
  example itself stays on SSE (`MCP_TRANSPORT=http`).
