import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleAdditionalTools } from '../src/additional-handlers.js';
import { AnythingLLMClient } from '../src/client.js';
import { additionalTools } from '../src/additional-tools.js';

describe('upload tools', () => {
  it('registers upload_file and upload_file_to_folder', () => {
    const names = additionalTools.map(t => t.name);
    expect(names).toContain('upload_file');
    expect(names).toContain('upload_file_to_folder');
  });

  it('upload_file uploads to /api/v1/document/upload and embeds into workspace', async () => {
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

      expect(result.success).toBe(true);
      expect(requests).toHaveLength(2);
      expect(requests[0].url).toBe('/api/v1/document/upload');
      expect(requests[0].method).toBe('POST');
      expect(requests[1].url).toBe('/api/v1/workspace/my-workspace/update-embeddings');
      expect(requests[1].method).toBe('POST');

      const embedBody = JSON.parse(requests[1].body.toString());
      expect(embedBody.adds).toEqual(['custom-documents/test.txt-uuid.json']);
    } finally {
      server.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('upload_file_to_folder uploads to /api/v1/document/upload/{folderName}', async () => {
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

      expect(result.success).toBe(true);
      expect(requests).toHaveLength(2);
      expect(requests[0].url).toBe('/api/v1/document/upload/my-folder');
      expect(requests[0].method).toBe('POST');
      expect(requests[1].url).toBe('/api/v1/workspace/my-workspace/update-embeddings');
      expect(requests[1].method).toBe('POST');

      const embedBody = JSON.parse(requests[1].body.toString());
      expect(embedBody.adds).toEqual(['custom-documents/my-folder/test.txt-uuid.json']);
    } finally {
      server.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
