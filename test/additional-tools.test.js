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
    name: 'get_chat_history (default limit)',
    args: { slug: 'ws' },
    method: 'getWorkspaceChatHistory',
    expectedArgs: ['ws', 100],
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
  {
    name: 'search_workspace (default limit)',
    args: { slug: 'ws', query: 'q' },
    method: 'searchWorkspace',
    expectedArgs: ['ws', 'q', 10],
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
  const distinctTools = new Set(CASES.map((c) => c.name.split(' ')[0]));
  assert.equal(distinctTools.size, 27, `expected 27 distinct additional tools, got ${distinctTools.size}`);
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
