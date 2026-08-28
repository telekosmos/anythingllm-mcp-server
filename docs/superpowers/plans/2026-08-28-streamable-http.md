# Streamable HTTP Transport + Tool Wiring Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Streamable HTTP transport (`MCP_TRANSPORT=streamable-http`) to the MCP server and add tests covering the previously-undocumented tools.

**Architecture:** `resolveTransportConfig` accepts a third mode, `streamable-http`. A new `startStreamableHttpTransport(config)` runs a Node `http` server on the same `MCP_HOST`/`MCP_PORT` with a single `/mcp` endpoint, routing requests by the `mcp-session-id` header to per-session `StreamableHTTPServerTransport` instances (each with its own `createMcpServer()`). Tests: unit tests for the new mode, integration tests over Streamable HTTP (mirroring the SSE suite), and mock-client wiring tests for `handleAdditionalTools`.

**Tech Stack:** Node.js 22, `@modelcontextprotocol/sdk` v1.30 (`StreamableHTTPServerTransport`, `StreamableHTTPClientTransport`), Node `node:http`/`node:crypto`. No new npm dependencies. No docker execution (per user instruction).

Reference spec: `docs/superpowers/specs/2026-08-28-streamable-http-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/index.js` | Modify | Accept `streamable-http` mode; add `startStreamableHttpTransport`; branch in `main()` |
| `test/transport.test.js` | Modify | Add `streamable-http` mode unit test |
| `test/streamable-http.test.js` | Create | Integration tests (single + concurrent sessions, core tool dispatch) |
| `test/additional-tools.test.js` | Create | Mock-client wiring tests for all 27 additional tools |
| `README.md` | Modify | Document Streamable HTTP mode |
| `examples/docker-compose.yml` | Modify | Header note about the `streamable-http` alternative |

---

## Task 1: Accept `streamable-http` mode

**Files:**
- Modify: `src/index.js` (`resolveTransportConfig`, lines 35-47)
- Modify: `test/transport.test.js`

- [ ] **Step 1: Add the failing unit test**

Append to `test/transport.test.js`:

```js
test('resolveTransportConfig honors streamable-http mode', () => {
  assert.deepEqual(resolveTransportConfig({ MCP_TRANSPORT: 'streamable-http' }), {
    mode: 'streamable-http',
    host: '0.0.0.0',
    port: 4001,
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/transport.test.js`
Expected: FAIL — `Invalid MCP_TRANSPORT "streamable-http"` is thrown.

- [ ] **Step 3: Update `resolveTransportConfig`**

In `src/index.js`, replace the mode validation inside `resolveTransportConfig`:

```js
  const mode = env.MCP_TRANSPORT || 'stdio';
  if (mode !== 'stdio' && mode !== 'http' && mode !== 'streamable-http') {
    throw new Error(`Invalid MCP_TRANSPORT "${mode}": expected "stdio", "http", or "streamable-http"`);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/transport.test.js`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/index.js test/transport.test.js
git commit -m "feat: accept streamable-http MCP_TRANSPORT mode"
```

---

## Task 2: Streamable HTTP transport + integration tests

**Files:**
- Modify: `src/index.js` (imports, `startStreamableHttpTransport`, `main()`)
- Create: `test/streamable-http.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `test/streamable-http.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer, createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SERVER_PATH = path.join(ROOT, 'src', 'index.js');
const EXPECTED_TOOL_COUNT = 38;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, attempts = 40) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      const socket = createConnection(port, '127.0.0.1', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        tries += 1;
        if (tries >= attempts) reject(new Error('MCP server did not start listening'));
        else setTimeout(check, 100);
      });
    };
    check();
  });
}

async function startServer() {
  const port = await getFreePort();
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      ANYTHINGLLM_API_KEY: 'test-key',
      ANYTHINGLLM_BASE_URL: 'http://localhost:3001',
      MCP_TRANSPORT: 'streamable-http',
      MCP_HOST: '127.0.0.1',
      MCP_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(port);
  return { child, port, close: () => child.kill() };
}

function makeClient(port) {
  return {
    client: new Client({ name: 'streamable-test', version: '1.0.0' }),
    transport: new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
  };
}

test('server starts over Streamable HTTP and registers all 38 tools', async () => {
  const server = await startServer();
  const { client, transport } = makeClient(server.port);
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, EXPECTED_TOOL_COUNT, 'unexpected number of registered tools');
    assert.ok(tools.some((tool) => tool.name === 'create_workspace'), 'expected create_workspace');
  } finally {
    await client.close();
    server.close();
  }
});

test('core system-settings tools dispatch over Streamable HTTP', async () => {
  const server = await startServer();
  const { client, transport } = makeClient(server.port);
  try {
    await client.connect(transport);
    for (const name of ['get_system_settings', 'update_system_settings']) {
      const result = await client.callTool({
        name,
        arguments: name === 'update_system_settings' ? { settings: {} } : {},
      });
      const text = result.content?.[0]?.text ?? '';
      assert.equal(result.isError, true, `${name} should fail against the unreachable backend`);
      assert.ok(!/Unknown tool/.test(text), `${name} should not dispatch as 'Unknown tool'`);
    }
  } finally {
    await client.close();
    server.close();
  }
});

test('supports two concurrent Streamable HTTP sessions', async () => {
  const server = await startServer();
  const a = makeClient(server.port);
  const b = makeClient(server.port);
  try {
    await Promise.all([a.client.connect(a.transport), b.client.connect(b.transport)]);
    const [ra, rb] = await Promise.all([a.client.listTools(), b.client.listTools()]);
    assert.equal(ra.tools.length, EXPECTED_TOOL_COUNT);
    assert.equal(rb.tools.length, EXPECTED_TOOL_COUNT);
  } finally {
    await Promise.allSettled([a.client.close(), b.client.close()]);
    server.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/streamable-http.test.js`
Expected: FAIL — "MCP server did not start listening" (server exits because `streamable-http` mode is rejected by `resolveTransportConfig`).

- [ ] **Step 3: Implement the Streamable HTTP transport**

In `src/index.js`:

1. Add imports after the `node:url`/`node:http` imports (after line 5 `import { createServer } from 'node:http';`):

```js
import { randomUUID } from 'node:crypto';
```

2. Add the SDK import after the SSE import (line 8):

```js
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
```

3. Insert a new `startStreamableHttpTransport` function right after `startHttpTransport` (which ends at line 100, before `const DEFAULT_BASE_URL`):

```js
async function startStreamableHttpTransport(config) {
  const sessions = new Map();

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/mcp') {
        res.writeHead(404).end('Not found');
        return;
      }

      const sessionId = req.headers['mcp-session-id'];
      if (sessionId) {
        const transport = sessions.get(sessionId);
        if (!transport) {
          res.writeHead(404).end('Unknown session');
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: () => {
          sessions.set(transport.sessionId, transport);
        },
      });
      transport.onclose = () => {
        sessions.delete(transport.sessionId);
      };
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('HTTP transport error:', error);
      if (!res.headersSent) {
        res.writeHead(500).end(String(error.message || error));
      }
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, resolve);
  });
  console.error(
    `AnythingLLM MCP Server (Streamable HTTP) listening on http://${config.host}:${config.port}/mcp`
  );
}
```

4. Replace the `main()` function with:

```js
async function main() {
  const transportConfig = resolveTransportConfig(process.env);
  if (transportConfig.mode === 'http') {
    await startHttpTransport(transportConfig);
  } else if (transportConfig.mode === 'streamable-http') {
    await startStreamableHttpTransport(transportConfig);
  } else {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('AnythingLLM MCP Server started');
  }
}
```

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `node --test test/streamable-http.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npm test`
Expected: PASS — existing stdio, SSE, and transport tests plus the new ones.

- [ ] **Step 6: Commit**

```bash
git add src/index.js test/streamable-http.test.js
git commit -m "feat: add Streamable HTTP transport gated by MCP_TRANSPORT=streamable-http"
```

---

## Task 3: Mock-client wiring tests for `handleAdditionalTools`

**Files:**
- Create: `test/additional-tools.test.js`

- [ ] **Step 1: Write the tests**

Create `test/additional-tools.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAdditionalTools } from '../src/additional-handlers.js';

function makeMockClient() {
  const methods = [
    'listUsers',
    'createUser',
    'updateUser',
    'deleteUser',
    'listApiKeys',
    'createApiKey',
    'deleteApiKey',
    'embedTextInWorkspace',
    'embedWebpage',
    'getWorkspaceChatHistory',
    'clearWorkspaceChatHistory',
    'getSystemInfo',
    'getSystemStats',
    'listLLMProviders',
    'updateLLMProvider',
    'getVectorDatabaseInfo',
    'updateVectorDatabase',
    'getWorkspaceSettings',
    'updateWorkspaceSettings',
    'processDocument',
    'getDocumentVectors',
    'searchWorkspace',
    'listAgents',
    'createAgent',
    'updateAgent',
    'deleteAgent',
    'invokeAgent',
  ];
  const calls = new Map();
  const client = {};
  for (const m of methods) {
    client[m] = async (...args) => {
      calls.set(m, args);
      return { ok: true, method: m, args };
    };
  }
  return { client, calls };
}

const CASES = [
  { name: 'list_users', args: {}, method: 'listUsers', expectedArgs: [] },
  {
    name: 'create_user',
    args: { username: 'alice', password: 'pw', role: 'admin' },
    method: 'createUser',
    expectedArgs: [{ username: 'alice', password: 'pw', role: 'admin' }],
  },
  {
    name: 'update_user',
    args: { userId: 'u1', updates: { role: 'user' } },
    method: 'updateUser',
    expectedArgs: ['u1', { role: 'user' }],
  },
  { name: 'delete_user', args: { userId: 'u1' }, method: 'deleteUser', expectedArgs: ['u1'] },
  { name: 'list_api_keys', args: {}, method: 'listApiKeys', expectedArgs: [] },
  { name: 'create_api_key', args: { name: 'ci' }, method: 'createApiKey', expectedArgs: ['ci'] },
  { name: 'delete_api_key', args: { keyId: 'k1' }, method: 'deleteApiKey', expectedArgs: ['k1'] },
  {
    name: 'embed_text',
    args: { slug: 'ws', texts: ['a'] },
    method: 'embedTextInWorkspace',
    expectedArgs: ['ws', ['a']],
  },
  {
    name: 'embed_webpage',
    args: { slug: 'ws', url: 'https://example.com' },
    method: 'embedWebpage',
    expectedArgs: ['ws', 'https://example.com'],
  },
  {
    name: 'get_chat_history',
    args: { slug: 'ws', limit: 50 },
    method: 'getWorkspaceChatHistory',
    expectedArgs: ['ws', 50],
  },
  {
    name: 'clear_chat_history',
    args: { slug: 'ws' },
    method: 'clearWorkspaceChatHistory',
    expectedArgs: ['ws'],
  },
  { name: 'get_system_info', args: {}, method: 'getSystemInfo', expectedArgs: [] },
  { name: 'get_system_stats', args: {}, method: 'getSystemStats', expectedArgs: [] },
  { name: 'list_llm_providers', args: {}, method: 'listLLMProviders', expectedArgs: [] },
  {
    name: 'update_llm_provider',
    args: { provider: 'openai', apiKey: 'x', model: 'gpt-4' },
    method: 'updateLLMProvider',
    expectedArgs: ['openai', { apiKey: 'x', model: 'gpt-4' }],
  },
  { name: 'get_vector_database_info', args: {}, method: 'getVectorDatabaseInfo', expectedArgs: [] },
  {
    name: 'update_vector_database',
    args: { provider: 'lancedb', config: { a: 1 } },
    method: 'updateVectorDatabase',
    expectedArgs: [{ a: 1 }],
  },
  {
    name: 'get_workspace_settings',
    args: { slug: 'ws' },
    method: 'getWorkspaceSettings',
    expectedArgs: ['ws'],
  },
  {
    name: 'update_workspace_settings',
    args: { slug: 'ws', settings: { temperature: 0.1 } },
    method: 'updateWorkspaceSettings',
    expectedArgs: ['ws', { temperature: 0.1 }],
  },
  {
    name: 'process_document_url',
    args: { slug: 'ws', url: 'https://example.com/doc.pdf' },
    method: 'processDocument',
    expectedArgs: ['ws', 'https://example.com/doc.pdf'],
  },
  {
    name: 'get_document_vectors',
    args: { slug: 'ws', documentId: 'd1' },
    method: 'getDocumentVectors',
    expectedArgs: ['ws', 'd1'],
  },
  {
    name: 'search_workspace',
    args: { slug: 'ws', query: 'q', limit: 5 },
    method: 'searchWorkspace',
    expectedArgs: ['ws', 'q', 5],
  },
  { name: 'list_agents', args: {}, method: 'listAgents', expectedArgs: [] },
  {
    name: 'create_agent',
    args: { name: 'ag', systemPrompt: 'p', tools: ['search_workspace'] },
    method: 'createAgent',
    expectedArgs: [{ name: 'ag', systemPrompt: 'p', tools: ['search_workspace'] }],
  },
  {
    name: 'update_agent',
    args: { agentId: 'a1', updates: { name: 'ag2' } },
    method: 'updateAgent',
    expectedArgs: ['a1', { name: 'ag2' }],
  },
  { name: 'delete_agent', args: { agentId: 'a1' }, method: 'deleteAgent', expectedArgs: ['a1'] },
  {
    name: 'invoke_agent',
    args: { agentId: 'a1', input: 'hello' },
    method: 'invokeAgent',
    expectedArgs: ['a1', 'hello'],
  },
];

test('handleAdditionalTools maps each tool to the correct client method', async (t) => {
  for (const c of CASES) {
    await t.test(c.name, async () => {
      const { client, calls } = makeMockClient();
      const result = await handleAdditionalTools(c.name, c.args, client);
      assert.ok(calls.has(c.method), `expected ${c.method} to be called`);
      assert.deepEqual(calls.get(c.method), c.expectedArgs);
      assert.deepEqual(result, { ok: true, method: c.method, args: c.expectedArgs });
    });
  }
});

test('handleAdditionalTools returns null for an unknown tool', async () => {
  const { client } = makeMockClient();
  const result = await handleAdditionalTools('does_not_exist', {}, client);
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `node --test test/additional-tools.test.js`
Expected: PASS (27 subtests + 1).

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new ones.

- [ ] **Step 4: Commit**

```bash
git add test/additional-tools.test.js
git commit -m "test: verify handleAdditionalTools wiring for all additional tools"
```

---

## Task 4: Documentation (README + compose header note)

**Files:**
- Modify: `README.md`
- Modify: `examples/docker-compose.yml`

- [ ] **Step 1: Update the README env table**

In `README.md`, change the `MCP_TRANSPORT` row in the Docker section's env table:

```markdown
| `MCP_TRANSPORT` | `stdio` | Transport to serve: `stdio`, `http` (SSE), or `streamable-http` |
```

- [ ] **Step 2: Add a Streamable HTTP mode subsection**

In `README.md`, immediately after the "### Run in HTTP/SSE mode" section (after its `npm run docker:run` block and the `host.docker.internal` note), add:

```markdown
### Run in Streamable HTTP mode

The modern MCP transport standard (Streamable HTTP) is available as
`MCP_TRANSPORT=streamable-http`. It exposes a single endpoint
`http://<host>:4001/mcp` and manages sessions via the `mcp-session-id` header:

```bash
docker run --rm -p 4001:4001 \
  -e MCP_TRANSPORT=streamable-http \
  -e ANYTHINGLLM_BASE_URL=http://localhost:3001 \
  -e ANYTHINGLLM_API_KEY=your-key \
  anythingllm-mcp-server:latest
```

Point an MCP client that supports Streamable HTTP at the `/mcp` endpoint:

```json
{
  "mcpServers": {
    "anythingllm": {
      "type": "http",
      "url": "http://localhost:4001/mcp"
    }
  }
}
```

The SSE transport (`MCP_TRANSPORT=http`) remains available and unchanged.
```

- [ ] **Step 3: Add a compose header note**

In `examples/docker-compose.yml`, add a line to the header comment block (after the `http://anythingllm-mcp:4001/sse` line):

```yaml
#   Streamable HTTP alternative: set MCP_TRANSPORT=streamable-http and point the
#   client at http://anythingllm-mcp:4001/mcp instead of /sse.
```

- [ ] **Step 4: Validate**

Run: `ruby -ryaml -e "YAML.load_file('examples/docker-compose.yml'); puts 'YAML OK'"`
Expected: prints `YAML OK`.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md examples/docker-compose.yml
git commit -m "docs: document Streamable HTTP transport mode"
```

---

## Final Verification

Run from repo root:

```bash
npm test
```

Expected: all tests pass (transport, stdio boot, SSE, Streamable HTTP, additional-tools wiring).

---

## Self-Review Notes

- Spec coverage: transport code (Tasks 1-2), integration tests (Task 2), tool wiring tests (Task 3), docs (Task 4). No `.github/` changes anywhere.
- Name consistency: `startStreamableHttpTransport(config)` mirrors `startHttpTransport(config)`; `transportConfig.mode` values are `stdio` | `http` | `streamable-http` everywhere; session routing uses `transport.handleRequest(req, res)`.
- Logging stays on stderr in all transports.
- No existing test files are edited except `test/transport.test.js` (additive).
