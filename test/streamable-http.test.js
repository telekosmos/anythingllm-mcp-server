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
