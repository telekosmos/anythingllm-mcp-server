import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SERVER_PATH = path.join(ROOT, 'src', 'index.js');

const EXPECTED_TOOLS = [
  'initialize_anythingllm',
  'list_workspaces',
  'get_workspace',
  'create_workspace',
  'update_workspace',
  'delete_workspace',
  'chat_with_workspace',
  'list_documents',
  'delete_document',
  'get_system_settings',
  'update_system_settings',
  'list_users',
  'create_user',
  'update_user',
  'delete_user',
  'list_api_keys',
  'create_api_key',
  'delete_api_key',
  'embed_text',
  'embed_webpage',
  'get_chat_history',
  'clear_chat_history',
  'get_system_info',
  'get_system_stats',
  'list_llm_providers',
  'update_llm_provider',
  'get_vector_database_info',
  'update_vector_database',
  'get_workspace_settings',
  'update_workspace_settings',
  'process_document_url',
  'get_document_vectors',
  'search_workspace',
  'list_agents',
  'create_agent',
  'update_agent',
  'delete_agent',
  'invoke_agent',
];

function startServer() {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      ANYTHINGLLM_API_KEY: 'test-key',
      ANYTHINGLLM_BASE_URL: 'http://localhost:3001',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuffer = '';
  const pending = new Map();
  let nextId = 0;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let index;
    while ((index = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, index).trim();
      stdoutBuffer = stdoutBuffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    }
  });

  child.on('exit', () => {
    for (const { reject } of pending.values()) {
      reject(new Error('Server exited before responding'));
    }
    pending.clear();
  });

  function request(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 10000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  return { child, request, close: () => child.kill() };
}

test('server starts over stdio and registers all expected tools', async () => {
  const server = startServer();
  try {
    const init = await server.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'ci-test', version: '1.0.0' },
    });
    assert.ok(init.serverInfo, 'initialize should return serverInfo');
    assert.equal(init.protocolVersion, '2025-03-26');

    server.child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    );

    const { tools } = await server.request('tools/list');
    assert.equal(tools.length, EXPECTED_TOOLS.length, 'unexpected number of registered tools');
    const names = new Set(tools.map((tool) => tool.name));
    for (const name of EXPECTED_TOOLS) {
      assert.ok(names.has(name), `missing tool: ${name}`);
    }
  } finally {
    server.close();
  }
});
