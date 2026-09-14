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

test('resolveTransportConfig honors streamable-http mode', () => {
  assert.deepEqual(resolveTransportConfig({ MCP_TRANSPORT: 'streamable-http' }), {
    mode: 'streamable-http',
    host: '0.0.0.0',
    port: 4001,
  });
});
