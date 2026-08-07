# Upload File Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two MCP tools, `upload_file` and `upload_file_to_folder`, that let an agent upload a local file into an AnythingLLM workspace using the existing two-step upload + `update-embeddings` pattern.

**Architecture:** Extend `AnythingLLMClient.uploadDocument` to support an optional folder path. Register the new tools in `additional-tools.js` and route them in `additional-handlers.js` by reading the local file as a stream and delegating to the client. Verify with a small Node.js built-in test using a local HTTP server.

**Tech Stack:** Node.js 18+, `node-fetch`, `form-data`, `node:test` / `node:assert`.

---

## Task 1: Write the failing test

**Files:**
- Create: `tests/upload-tools.test.js`

Add a test file that verifies the new tools are registered, the handler routes to `uploadDocument`, and the client hits the correct upload endpoint and the correct `update-embeddings` endpoint.

- [ ] **Step 1: Create the test file**

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleAdditionalTools } from '../src/additional-handlers.js';
import { AnythingLLMClient } from '../src/client.js';
import { additionalTools } from '../src/additional-tools.js';

describe('upload tools', () => {
  test('upload_file and upload_file_to_folder are registered', () => {
    const names = additionalTools.map(t => t.name);
    assert(names.includes('upload_file'), 'upload_file should be registered');
    assert(names.includes('upload_file_to_folder'), 'upload_file_to_folder should be registered');
  });

  test('upload_file uploads to /api/v1/document/upload and embeds into workspace', async () => {
    const requests = [];
    const server = createServer((req, res) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        requests.push({
          url: req.url,
          method: req.method,
          body: Buffer.concat(chunks)
        });
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

      assert.strictEqual(result.success, true);
      assert.strictEqual(requests.length, 2);
      assert.strictEqual(requests[0].url, '/api/v1/document/upload');
      assert.strictEqual(requests[0].method, 'POST');
      assert.strictEqual(requests[1].url, '/api/v1/workspace/my-workspace/update-embeddings');
      assert.strictEqual(requests[1].method, 'POST');

      const embedBody = JSON.parse(requests[1].body.toString());
      assert.deepStrictEqual(embedBody.adds, ['custom-documents/test.txt-uuid.json']);
    } finally {
      server.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('upload_file_to_folder uploads to /api/v1/document/upload/{folderName}', async () => {
    const requests = [];
    const server = createServer((req, res) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        requests.push({ url: req.url, method: req.method });
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

      assert.strictEqual(result.success, true);
      assert.strictEqual(requests.length, 2);
      assert.strictEqual(requests[0].url, '/api/v1/document/upload/my-folder');
      assert.strictEqual(requests[0].method, 'POST');
      assert.strictEqual(requests[1].url, '/api/v1/workspace/my-workspace/update-embeddings');
    } finally {
      server.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Ensure the tests directory exists**

Run: `mkdir -p tests`

- [ ] **Step 3: Run the test to confirm it fails**

Run: `node --test tests/upload-tools.test.js`

Expected: FAIL — `upload_file` and `upload_file_to_folder` are not registered, and the handler returns `null` for both tools.

---

## Task 2: Extend the client upload endpoint to support folders

**Files:**
- Modify: `src/client.js:109-136`

Extend `uploadDocument` so it can POST to either `/api/v1/document/upload` or `/api/v1/document/upload/{folderName}` while keeping the existing two-step `update-embeddings` behavior.

- [ ] **Step 1: Modify `uploadDocument` to accept an optional `folderName`**

Replace the existing `uploadDocument` method with this implementation:

```javascript
  async uploadDocument(workspaceSlug, documentData, folderName) {
    const formData = new FormData();
    formData.append('file', documentData.file, documentData.filename || 'document');

    const endpoint = folderName
      ? `/api/v1/document/upload/${safePathSegment(folderName)}`
      : '/api/v1/document/upload';

    // Step 1: Upload to system documents
    const uploadResponse = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: formData
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      throw new Error(`AnythingLLM upload error: ${uploadResponse.status} - ${error}`);
    }

    const uploadResult = await uploadResponse.json();

    // Step 2: Add uploaded document to workspace
    if (uploadResult.documents && uploadResult.documents.length > 0) {
      const docPaths = uploadResult.documents.map(doc => doc.location);
      await this.addDocumentsToWorkspace(workspaceSlug, docPaths);
    }

    return uploadResult;
  }
```

- [ ] **Step 2: Run the test to confirm the folder endpoint is used**

Run: `node --test tests/upload-tools.test.js`

Expected: FAIL — the tool registration test still fails because the tools are not yet registered. The folder endpoint test should now pass if the client change is correct.

---

## Task 3: Register the two new tools

**Files:**
- Modify: `src/additional-tools.js:292-310` (Document Processing section)

Insert the two new tool definitions right after `process_document_url` in the Document Processing section.

- [ ] **Step 1: Add tool metadata**

Replace the Document Processing section starting at line 292 with the following expanded block:

```javascript
  // Document Processing
  {
    name: 'process_document_url',
    description: 'Process a document from a URL',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'The workspace slug/identifier'
        },
        url: {
          type: 'string',
          description: 'URL of the document to process'
        }
      },
      required: ['slug', 'url']
    }
  },
  {
    name: 'upload_file',
    description: 'Upload a local file to a workspace',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'The workspace slug/identifier'
        },
        filePath: {
          type: 'string',
          description: 'Absolute path to the local file to upload'
        }
      },
      required: ['slug', 'filePath']
    }
  },
  {
    name: 'upload_file_to_folder',
    description: 'Upload a local file to a specific folder in a workspace',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'The workspace slug/identifier'
        },
        folderName: {
          type: 'string',
          description: 'Target folder path to upload the file into'
        },
        filePath: {
          type: 'string',
          description: 'Absolute path to the local file to upload'
        }
      },
      required: ['slug', 'folderName', 'filePath']
    }
  },
  {
    name: 'get_document_vectors',
    ...
```

(Keep `get_document_vectors` and the rest of the file unchanged.)

- [ ] **Step 2: Run the test to confirm registration passes**

Run: `node --test tests/upload-tools.test.js`

Expected: FAIL — the handler still returns `null` for the new tools, so the handler tests fail. The registration test should pass.

---

## Task 4: Route the new tools in the handler

**Files:**
- Modify: `src/additional-handlers.js:1` (add imports)
- Modify: `src/additional-handlers.js:94-102` (Document Processing cases)

Add the necessary imports and two new switch cases that read the local file as a stream and call `client.uploadDocument`.

- [ ] **Step 1: Add imports at the top of the file**

```javascript
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
```

- [ ] **Step 2: Add handler cases after `process_document_url`**

Replace the Document Processing switch block:

```javascript
    // Document Processing
    case 'process_document_url':
      result = await client.processDocument(args.slug, args.url);
      break;

    case 'upload_file': {
      const fileStream = createReadStream(args.filePath);
      result = await client.uploadDocument(args.slug, {
        file: fileStream,
        filename: basename(args.filePath)
      });
      break;
    }

    case 'upload_file_to_folder': {
      const fileStream = createReadStream(args.filePath);
      result = await client.uploadDocument(args.slug, {
        file: fileStream,
        filename: basename(args.filePath)
      }, args.folderName);
      break;
    }

    case 'get_document_vectors':
      result = await client.getDocumentVectors(args.slug, args.documentId);
      break;
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test tests/upload-tools.test.js`

Expected: PASS — all three tests should pass.

---

## Task 5: Verify integration and commit

- [ ] **Step 1: Run the server start command to ensure no syntax errors**

Run: `node --check src/client.js && node --check src/additional-tools.js && node --check src/additional-handlers.js`

Expected: No output (Node.js exits 0 for each file).

- [ ] **Step 2: Run the tests one final time**

Run: `node --test tests/upload-tools.test.js`

Expected: PASS.

- [ ] **Step 3: Commit the changes**

```bash
git add src/client.js src/additional-tools.js src/additional-handlers.js tests/upload-tools.test.js
git commit -m "feat: expose upload_file and upload_file_to_folder tools"
```

---

## Plan Self-Review

**Spec coverage:**
- `upload_file` tool exposed? Yes — Task 3.
- `upload_file_to_folder` tool exposed? Yes — Task 3.
- Local file path read as a stream? Yes — Task 4.
- Existing two-step upload + `update-embeddings` pattern kept? Yes — Task 2 reuses `uploadDocument`/`addDocumentsToWorkspace`.
- `folderName` encoded via `safePathSegment`? Yes — Task 2.
- Tools live in `additional-tools.js`? Yes — Task 3.

**Placeholder scan:**
- No TBD, TODO, or vague steps. Every code snippet is complete and every command is exact.

**Type consistency:**
- `uploadDocument` signature is `(workspaceSlug, documentData, folderName)` across all tasks.
- Tool names are `upload_file` and `upload_file_to_folder` in metadata and handlers.
- `args.filePath` and `args.folderName` are used consistently in the handler cases.
