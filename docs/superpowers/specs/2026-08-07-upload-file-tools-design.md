# Upload File Tools Design

**Date:** 2026-08-07
**Topic:** Expose AnythingLLM document upload endpoints as MCP tools

## Goal

Expose two new MCP tools so that an agent can upload a file from the local file system into an AnythingLLM workspace:

1. `upload_file` — uploads a local file to `/api/v1/document/upload` and embeds it into a workspace.
2. `upload_file_to_folder` — uploads a local file to `/api/v1/document/upload/{folderName}` and embeds it into a workspace.

## Constraints

- Keep the codebase consistent with the existing two-step upload pattern used by `AnythingLLMClient.uploadDocument` (upload via `document/upload`, then add to workspace via `workspace/{slug}/update-embeddings`).
- Do not use the API's built-in `addToWorkspaces` form field; follow the existing `update-embeddings` flow.
- Tools must be discoverable through the existing `ListToolsRequestSchema` handler and executable through the existing `CallToolRequestSchema` handler.
- Only use the `ANYTHINGLLM_BASE_URL` configured at server startup; do not accept a `baseUrl` argument.
- Path parameters must be encoded with the existing `safePathSegment` helper.

## Proposed Approach

Add both tools in `src/additional-tools.js` under the Document Processing section (alongside `embed_text`, `embed_webpage`, `process_document_url`). This keeps document-processing features grouped together and avoids growing `src/index.js`.

### Tool Metadata

```text
upload_file
  slug:       string  (required) — workspace slug to embed the file into
  filePath:   string  (required) — absolute path to the local file to upload

upload_file_to_folder
  slug:       string  (required) — workspace slug to embed the file into
  folderName: string  (required) — target folder path
  filePath:   string  (required) — absolute path to the local file to upload
```

### Client Changes

Extend `AnythingLLMClient.uploadDocument(workspaceSlug, documentData, folderName)` to:

- Accept an optional third argument `folderName`.
- When `folderName` is provided, POST to `/api/v1/document/upload/${safePathSegment(folderName)}`.
- Otherwise POST to `/api/v1/document/upload`.
- Keep the existing FormData construction and the existing two-step `update-embeddings` call to add the uploaded documents to the workspace.

### Handler Changes

In `src/additional-handlers.js`, add two new cases:

- `upload_file`: read the local file at `args.filePath` using `fs.createReadStream`, derive the filename from the path, and call `client.uploadDocument(args.slug, { file: stream, filename }, null)`.
- `upload_file_to_folder`: do the same but pass `args.folderName` as the third argument.

Both handlers remain within the existing `handleAdditionalTools` switch and reuse the existing `client` instance.

### Error Handling

- Missing/empty `slug`, `filePath`, or `folderName` will produce validation errors consistent with the existing helper style.
- File-system errors (file not found, permission denied) will propagate as tool errors and be returned by the existing `CallToolRequestSchema` error handler.
- AnythingLLM API errors will be returned as they are today (status code + body text).

## Affected Files

1. `src/client.js` — extend `uploadDocument` to support folder upload endpoint.
2. `src/additional-tools.js` — add tool metadata for `upload_file` and `upload_file_to_folder`.
3. `src/additional-handlers.js` — add handler cases and import `fs`/`path` helpers.

## Out of Scope

- Refactoring other tools or endpoints.
- Changing the existing `uploadDocument` behavior for callers that do not pass a folder name.
- Adding file content validation, mime-type checks, or virus scanning.
- Exposing these tools in `src/index.js` core tool list (they will live in `additional-tools.js`).
