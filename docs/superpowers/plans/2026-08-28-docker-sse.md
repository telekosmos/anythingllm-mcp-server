# Docker Image + SSE Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this stdio-only MCP server usable in a multi-container docker-compose environment by adding an env-gated HTTP/SSE transport, a `Dockerfile`, npm build scripts, and an example compose file.

**Architecture:** `MCP_TRANSPORT` (default `stdio`) selects the transport in `main()`. In `http` mode a Node built-in `http` server exposes `GET /sse` (new `SSEServerTransport` per connection, tracked in a `Map<sessionId, transport>`) and `POST /messages` (routed by `?sessionId=`). A multi-stage `node:22-alpine` Dockerfile ships the runtime; npm scripts build/run the image; `examples/docker-compose.yml` wires it with an AnythingLLM container.

**Tech Stack:** Node.js 22, `@modelcontextprotocol/sdk` v1.x (`SSEServerTransport`/`SSEClientTransport`), Node `node:http`, Docker, docker compose. No new npm dependencies.

Reference spec: `docs/superpowers/specs/2026-08-28-docker-sse-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/index.js` | Modify | Add `resolveTransportConfig`, SSE HTTP server, transport branch in `main()`, export `resolveTransportConfig` |
| `test/transport.test.js` | Create | Unit tests for `resolveTransportConfig` |
| `test/sse.test.js` | Create | Integration test: SSE `initialize` + `tools/list` handshake |
| `Dockerfile` | Create | Multi-stage `node:22-alpine` image |
| `.dockerignore` | Create | Keep build context lean |
| `package.json` | Modify | Add `docker:build` and `docker:run` scripts |
| `examples/docker-compose.yml` | Create | anythingllm + anythingllm-mcp + hermes services |

---

## Task 1: `resolveTransportConfig` unit tests + implementation

**Files:**
- Create: `test/transport.test.js`
- Modify: `src/index.js`

- [ ] **Step 1: Write the failing unit test**

Create `test/transport.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTransportConfig } from '../src/index.js';

test('resolveTransportConfig defaults to stdio on 0.0.0.0:4001', () => {
  assert.deepEqual(resolveTransportConfig({}), {
    mode: 'stdio',
    host: '0.0.0.0',
    port: 4001,
  });
});

test('resolveTransportConfig honors explicit http mode', () => {
  assert.deepEqual(resolveTransportConfig({ MCP_TRANSPORT: 'http' }), {
    mode: 'http',
    host: '0.0.0.0',
    port: 4001,
  });
});

test('resolveTransportConfig honors custom host and port', () => {
  assert.deepEqual(
    resolveTransportConfig({
      MCP_TRANSPORT: 'http',
      MCP_HOST: '127.0.0.1',
      MCP_PORT: '8080',
    }),
    { mode: 'http', host: '127.0.0.1', port: 8080 }
  );
});

test('resolveTransportConfig throws on unknown transport value', () => {
  assert.throws(() => resolveTransportConfig({ MCP_TRANSPORT: 'sse' }), /Invalid MCP_TRANSPORT/);
});

test('resolveTransportConfig throws on invalid port', () => {
  assert.throws(() => resolveTransportConfig({ MCP_PORT: 'not-a-port' }), /Invalid MCP_PORT/);
  assert.throws(() => resolveTransportConfig({ MCP_PORT: '70000' }), /Invalid MCP_PORT/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/transport.test.js`
Expected: FAIL — `resolveTransportConfig is not a function` (not yet exported).

- [ ] **Step 3: Implement `resolveTransportConfig`**

In `src/index.js`, insert after the `validateBaseUrl` function (line 42) and before `const DEFAULT_BASE_URL`:

```js
const DEFAULT_MCP_HOST = '0.0.0.0';
const DEFAULT_MCP_PORT = 4001;

function resolveTransportConfig(env) {
  const mode = env.MCP_TRANSPORT || 'stdio';
  if (mode !== 'stdio' && mode !== 'http') {
    throw new Error(`Invalid MCP_TRANSPORT "${mode}": expected "stdio" or "http"`);
  }
  const host = env.MCP_HOST || DEFAULT_MCP_HOST;
  const rawPort = env.MCP_PORT || DEFAULT_MCP_PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid MCP_PORT "${rawPort}": expected a port number between 1 and 65535`);
  }
  return { mode, host, port };
}
```

Then update the export at the bottom of the file (line 373):

```js
export { validateBaseUrl, resolveTransportConfig };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/transport.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npm test`
Expected: PASS (all existing tests plus the 5 new ones).

- [ ] **Step 6: Commit**

```bash
git add test/transport.test.js src/index.js
git commit -m "feat: add env-gated transport config resolver"
```

---

## Task 2: SSE HTTP transport + integration test

**Files:**
- Create: `test/sse.test.js`
- Modify: `src/index.js`

- [ ] **Step 1: Write the failing integration test**

Create `test/sse.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SERVER_PATH = path.join(ROOT, 'src', 'index.js');

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
      const socket = createNetServer();
      socket.once('error', () => {
        tries += 1;
        if (tries >= attempts) reject(new Error('MCP server did not start listening'));
        else setTimeout(check, 100);
      });
      socket.connect(port, '127.0.0.1', () => {
        socket.end();
        resolve();
      });
    };
    check();
  });
}

test('server starts over SSE and registers all expected tools', async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      ANYTHINGLLM_API_KEY: 'test-key',
      ANYTHINGLLM_BASE_URL: 'http://localhost:3001',
      MCP_TRANSPORT: 'http',
      MCP_HOST: '127.0.0.1',
      MCP_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const client = new Client({ name: 'sse-test', version: '1.0.0' });
  const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${port}/sse`));

  try {
    await waitForServer(port);
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0, 'expected tools to be registered');
    assert.ok(tools.some((tool) => tool.name === 'create_workspace'), 'expected create_workspace');
  } finally {
    await client.close();
    child.kill();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/sse.test.js`
Expected: FAIL — timeout ("MCP server did not start listening") because `MCP_TRANSPORT=http` is not honored yet.

- [ ] **Step 3: Implement the SSE HTTP transport**

In `src/index.js`:

1. Add the import after line 3 (`import { pathToFileURL } from 'node:url';`):

```js
import { createServer } from 'node:http';
```

2. Add the SDK SSE import after the stdio import (line 6):

```js
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
```

3. Insert a new `startHttpTransport` function after `resolveTransportConfig` (i.e. after the block added in Task 1):

```js
async function startHttpTransport(config, mcpServer) {
  const sessions = new Map();

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/sse') {
        const transport = new SSEServerTransport('/messages', res);
        sessions.set(transport.sessionId, transport);
        transport.onclose = () => {
          sessions.delete(transport.sessionId);
        };
        await mcpServer.connect(transport);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/messages') {
        const sessionId = url.searchParams.get('sessionId');
        const transport = sessionId && sessions.get(sessionId);
        if (!transport) {
          res.writeHead(400).end('Unknown session');
          return;
        }
        await transport.handlePostMessage(req, res);
        return;
      }

      res.writeHead(404).end('Not found');
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
    `AnythingLLM MCP Server (SSE) listening on http://${config.host}:${config.port}/sse`
  );
}
```

4. Replace the `main()` function (lines 351-355) with:

```js
async function main() {
  const transportConfig = resolveTransportConfig(process.env);
  if (transportConfig.mode === 'http') {
    await startHttpTransport(transportConfig, server);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('AnythingLLM MCP Server started');
  }
}
```

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `node --test test/sse.test.js`
Expected: PASS (1/1). The test connects over SSE, performs `initialize`, and lists tools.

- [ ] **Step 5: Run the full suite to check for regressions (stdio path)**

Run: `npm test`
Expected: PASS — existing `boot.test.js` stdio test and all others still pass.

- [ ] **Step 6: Commit**

```bash
git add test/sse.test.js src/index.js
git commit -m "feat: add SSE HTTP transport gated by MCP_TRANSPORT"
```

---

## Task 3: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create the `.dockerignore`**

Create `.dockerignore`:

```
node_modules
.git
.github
__IGNORE__
.npmrc
.env
.env.*
docs
test
scripts
coverage
*.log
Dockerfile
.dockerignore
```

- [ ] **Step 2: Create the `Dockerfile`**

Create `Dockerfile`:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY src ./src
ENV MCP_TRANSPORT=stdio
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=4001
ENV ANYTHINGLLM_BASE_URL=http://localhost:3001
EXPOSE 4001
USER node
ENTRYPOINT ["node", "src/index.js"]
```

- [ ] **Step 3: Build the image**

Run: `docker build -t anythingllm-mcp-server:test .`
Expected: Build succeeds; image builds both stages.

- [ ] **Step 4: Smoke-test the image in stdio mode**

Run: `printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0.0"}}}\n' | docker run --rm -i anythingllm-mcp-server:test`
Expected: stdout contains a JSON-RPC response with `serverInfo` and `protocolVersion: "2025-03-26"`.

- [ ] **Step 5: Smoke-test the image in HTTP/SSE mode**

Run: `docker run --rm -d --name mcp-sse-test -p 4001:4001 -e MCP_TRANSPORT=http -e MCP_HOST=0.0.0.0 -e MCP_PORT=4001 anythingllm-mcp-server:test && sleep 2 && curl -sN http://127.0.0.1:4001/sse | head -c 200; docker rm -f mcp-sse-test`
Expected: output starts with `event: endpoint` and a `data:` line containing `/messages?sessionId=...`.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add multi-stage Dockerfile for the MCP server"
```

---

## Task 4: npm build/run scripts

**Files:**
- Modify: `package.json` (the `scripts` block, lines 13-18)

- [ ] **Step 1: Add the scripts**

In `package.json`, replace the `scripts` block with:

```json
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test",
    "docker:build": "docker build -t anythingllm-mcp-server:$(node -p \"require('./package.json').version\") -t anythingllm-mcp-server:latest .",
    "docker:run": "docker run --rm -p 4001:4001 -e MCP_TRANSPORT=http -e MCP_HOST=0.0.0.0 -e MCP_PORT=4001 -e ANYTHINGLLM_BASE_URL=http://localhost:3001 -e ANYTHINGLLM_API_KEY=$ANYTHINGLLM_API_KEY anythingllm-mcp-server:latest",
    "release": "./scripts/publish.sh",
    "release:quick": "./scripts/quick-publish.sh"
  },
```

- [ ] **Step 2: Validate the JSON and the scripts**

Run: `node -e "const p=require('./package.json'); console.log(p.scripts['docker:build']); console.log(p.scripts['docker:run'])"`
Expected: prints both script strings; no JSON parse error.

Run: `npm run docker:build`
Expected: builds and tags `anythingllm-mcp-server:<version>` and `anythingllm-mcp-server:latest`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add docker:build and docker:run npm scripts"
```

---

## Task 5: Example docker-compose.yml

**Files:**
- Create: `examples/docker-compose.yml`

- [ ] **Step 1: Create the compose example**

Create `examples/docker-compose.yml`:

```yaml
# Multi-container example: AnythingLLM + this MCP server + an MCP client.
#
#   anythingllm          - AnythingLLM API server
#   anythingllm-mcp      - this MCP server (SSE transport over HTTP)
#   hermes               - the MCP client (fill in your own image/config)
#
# The MCP server reaches AnythingLLM over the compose network at
# http://anythingllm:3001 and exposes its SSE endpoint at
# http://anythingllm-mcp:4001/sse.
#
# Usage:
#   docker compose -f examples/docker-compose.yml up

services:
  anythingllm:
    image: mintplexlabs/anythingllm:latest
    ports:
      - "3001:3001"
    environment:
      - JWT_SECRET=<generate-a-long-random-secret>
      - SIG_KEY=<generate-a-long-random-secret>
      - STORAGE_DIR=/app/server/storage
    volumes:
      - anythingllm-data:/app/server/storage
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3001/api/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 10s
      timeout: 5s
      retries: 5

  anythingllm-mcp:
    build:
      context: ..
      dockerfile: Dockerfile
    image: anythingllm-mcp-server:latest
    ports:
      - "4001:4001"
    environment:
      - MCP_TRANSPORT=http
      - MCP_HOST=0.0.0.0
      - MCP_PORT=4001
      - ANYTHINGLLM_BASE_URL=http://anythingllm:3001
      - ANYTHINGLLM_API_KEY=<your-anythingllm-api-key>
    depends_on:
      anythingllm:
        condition: service_healthy

  hermes:
    image: <your-hermes-image>
    environment:
      # Point the client at the MCP server's SSE endpoint:
      - MCP_URL=http://anythingllm-mcp:4001/sse
    depends_on:
      - anythingllm-mcp

volumes:
  anythingllm-data:
```

- [ ] **Step 2: Validate the compose file syntax**

Run: `docker compose -f examples/docker-compose.yml config`
Expected: prints the rendered compose config without errors. (Secrets are placeholders; `docker compose up` is intentionally not run here.)

- [ ] **Step 3: Commit**

```bash
git add examples/docker-compose.yml
git commit -m "docs: add multi-container docker-compose example"
```

---

## Final Verification

Run from repo root:

```bash
npm test
```

Expected: all tests pass (unit + stdio integration + SSE integration).

```bash
npm run docker:build
docker run --rm -i anythingllm-mcp-server:latest < /dev/null
```

Expected: image builds and the container exits cleanly when stdin closes (stdio mode default).

---

## Self-Review Notes

- Spec coverage: transport code (Tasks 1-2), Dockerfile + .dockerignore (Task 3), npm scripts (Task 4), compose example (Task 5), tests (Tasks 1-2), no GitHub Actions changes (none of the tasks touch `.github/`).
- Type/name consistency: `resolveTransportConfig(env)` returns `{ mode, host, port }`; `startHttpTransport(config, mcpServer)` consumes it; constants `DEFAULT_MCP_HOST`/`DEFAULT_MCP_PORT` used only inside `resolveTransportConfig`.
- Logging stays on stderr everywhere; the stdio boot test (which asserts a clean stdout) remains green.
