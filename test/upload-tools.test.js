import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleAdditionalTools } from '../src/additional-handlers.js';
import { AnythingLLMClient } from '../src/client.js';
import { additionalTools } from '../src/additional-tools.js';

test('registers upload_file and upload_file_to_folder', () => {
  const names = additionalTools.map(t => t.name);
  assert.ok(names.includes('upload_file'));
  assert.ok(names.includes('upload_file_to_folder'));
});

test('upload_file uploads to /api/v1/document/upload and embeds into workspace', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ url: req.url, method: req.method, body: Buffer.concat(chunks) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        documents: [{ location: 'custom-documents/test.txt-uuid.json' }]
      }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const tmpDir = mkdtempSync(join(tmpdir(), 'anythingllm-test-'));
  const filePath = join(tmpDir, 'test.txt');
  writeFileSync(filePath, 'hello world');

  try {
    const client = new AnythingLLMClient(baseUrl, 'test-key');
    const result = await handleAdditionalTools('upload_file', {
      slug: 'my-workspace',
      filePath
    }, client);

    assert.equal(result.success, true);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, '/api/v1/document/upload');
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[1].url, '/api/v1/workspace/my-workspace/update-embeddings');
    assert.equal(requests[1].method, 'POST');

    const embedBody = JSON.parse(requests[1].body.toString());
    assert.deepEqual(embedBody.adds, ['custom-documents/test.txt-uuid.json']);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('rejects invalid upload inputs', async () => {
  const client = new AnythingLLMClient('http://localhost:3001', 'test-key');

  await assert.rejects(
    handleAdditionalTools('upload_file', { slug: 'ws', filePath: '' }, client),
    /filePath is required and must be a non-empty string/
  );

  await assert.rejects(
    handleAdditionalTools('upload_file', { slug: 'ws', filePath: 'relative/path.txt' }, client),
    /filePath must be an absolute path/
  );

  await assert.rejects(
    handleAdditionalTools('upload_file', { slug: 'ws', filePath: '/tmp/../etc/passwd' }, client),
    /filePath must not contain parent directory references/
  );

  await assert.rejects(
    handleAdditionalTools('upload_file_to_folder', { slug: 'ws', filePath: '/tmp/test.txt' }, client),
    /folderName is required and must be a non-empty string/
  );
});

test('upload_file_to_folder uploads to /api/v1/document/upload/{folderName}', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ url: req.url, method: req.method, body: Buffer.concat(chunks) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        documents: [{ location: 'custom-documents/my-folder/test.txt-uuid.json' }]
      }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const tmpDir = mkdtempSync(join(tmpdir(), 'anythingllm-test-'));
  const filePath = join(tmpDir, 'test.txt');
  writeFileSync(filePath, 'hello world');

  try {
    const client = new AnythingLLMClient(baseUrl, 'test-key');
    const result = await handleAdditionalTools('upload_file_to_folder', {
      slug: 'my-workspace',
      folderName: 'my-folder',
      filePath
    }, client);

    assert.equal(result.success, true);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, '/api/v1/document/upload/my-folder');
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[1].url, '/api/v1/workspace/my-workspace/update-embeddings');
    assert.equal(requests[1].method, 'POST');

    const embedBody = JSON.parse(requests[1].body.toString());
    assert.deepEqual(embedBody.adds, ['custom-documents/my-folder/test.txt-uuid.json']);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(tmpDir, { recursive: true, force: true });
  }
});