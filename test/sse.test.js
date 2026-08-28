import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { createConnection } from 'node:net';
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
