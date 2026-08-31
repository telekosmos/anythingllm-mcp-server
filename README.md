# AnythingLLM MCP Server (Fixed Fork)

> **This is a fixed fork of [raqueljezweb/anythingllm-mcp-server](https://github.com/raqueljezweb/anythingllm-mcp-server)**
> Original package has broken API endpoints. This fork fixes them.

An MCP (Model Context Protocol) server that enables seamless integration between [AnythingLLM](https://anythingllm.com/) and MCP-compatible clients like Claude Code, Claude Desktop, and more.

## Quick Start for Claude Code

### 1. Add to your MCP configuration

Add this to `~/.claude.json` (or `%USERPROFILE%\.claude.json` on Windows):

```json
{
  "mcpServers": {
    "anythingllm": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@telekosmos/anythingllm-mcp-server"],
      "env": {
        "ANYTHINGLLM_API_KEY": "YOUR-API-KEY-HERE",
        "ANYTHINGLLM_BASE_URL": "http://localhost:3001"
      }
    }
  }
}
```

### 2. Get your API key

1. Open AnythingLLM → Settings → API Keys
2. Create a new API key
3. Copy it to the config above

### 3. Restart Claude Code

The MCP server will auto-initialize with the env variables.

---

## For LLMs: How to Use This MCP Server

**IMPORTANT**: This section is for AI assistants using this MCP server.

### Initialization (Required First!)

Before any operation, you MUST initialize the client:

```
mcp__anythingllm__initialize_anythingllm
  apiKey: "YOUR-API-KEY"  # Optional if ANYTHINGLLM_API_KEY is set in the environment
```

**Note:** Do not pass a `baseUrl` argument. The backend URL is configured by the host via the `ANYTHINGLLM_BASE_URL` environment variable. If `ANYTHINGLLM_API_KEY` is set in the environment, the server initializes automatically and this tool can be skipped or called without arguments.

### Core Workflow: RAG (Retrieval-Augmented Generation)

#### Step 1: Create a workspace
```
mcp__anythingllm__create_workspace
  name: "my-knowledge-base"
```

#### Step 2: Add documents (embed text)
```
mcp__anythingllm__embed_text
  slug: "my-knowledge-base"
  texts: ["Document content here...", "Another document..."]
```

#### Step 3: Query with RAG
```
mcp__anythingllm__chat_with_workspace
  slug: "my-knowledge-base"
  message: "What does the documentation say about X?"
  mode: "query"   # Use "query" for RAG, "chat" for conversation
```

### All Available Tools (38)

The server registers **38 tools**: the workspace/RAG tools below plus the
admin/management tools grouped underneath. Tools marked 🔐 manage credentials,
users, or system configuration — only expose the server to clients you trust if
you want those callable.

#### Workspaces

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `initialize_anythingllm` | **REQUIRED FIRST** — initialize the client | `apiKey` |
| `list_workspaces` | List all workspaces | - |
| `get_workspace` | Get workspace details + documents | `slug` |
| `create_workspace` | Create new workspace | `name` |
| `update_workspace` | Update workspace settings | `slug`, `updates` |
| `delete_workspace` | Delete workspace | `slug` |
| `get_workspace_settings` | Get settings for a workspace | `slug` |
| `update_workspace_settings` | Update settings for a workspace | `slug`, `settings` |

#### Documents & RAG

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `embed_text` | Add text to RAG | `slug`, `texts[]` |
| `embed_webpage` | Scrape & add webpage | `slug`, `url` |
| `list_documents` | List docs in workspace | `slug` |
| `delete_document` | Remove document | `slug`, `documentId` |
| `process_document_url` | Process a document from a URL | `slug`, `url` |
| `get_document_vectors` | Get vector embeddings for a document | `slug`, `documentId` |

#### Chat & Search

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `chat_with_workspace` | Query RAG / Chat | `slug`, `message`, `mode` |
| `search_workspace` | Vector similarity search | `slug`, `query`, `limit` |
| `get_chat_history` | Get conversation history | `slug`, `limit` |
| `clear_chat_history` | Clear all chat history for a workspace | `slug` |

#### Agents

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_agents` | List all agents | - |
| `create_agent` | Create an agent | `name`, `systemPrompt`, `tools[]` |
| `update_agent` | Update an agent | `agentId`, `updates` |
| `delete_agent` | Delete an agent | `agentId` |
| `invoke_agent` | Invoke an agent with input | `agentId`, `input` |

#### 🔐 System & Admin

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `get_system_settings` | Get system settings | - |
| `update_system_settings` | Update system settings | `settings` |
| `get_system_info` | Get general system information | - |
| `get_system_stats` | Get system statistics | - |
| `list_users` | List all users | - |
| `create_user` | Create a new user | `username`, `password`, `role` |
| `update_user` | Update an existing user | `userId`, `updates` |
| `delete_user` | Delete a user | `userId` |
| `list_api_keys` | List all API keys | - |
| `create_api_key` | Create a new API key | `name` |
| `delete_api_key` | Delete an API key | `keyId` |
| `list_llm_providers` | List available LLM providers | - |
| `update_llm_provider` | Update LLM provider config (incl. provider API key) | `provider`, `apiKey`, `model` |
| `get_vector_database_info` | Get vector database config | - |
| `update_vector_database` | Update vector database config | `provider`, `config` |

### Common Patterns

#### Pattern 1: Scrape web docs → Add to RAG → Query
```python
# 1. Create workspace
create_workspace(name="docs")

# 2. For each page, scrape with Crawl4AI then embed
#    (Use mcp__crawl4ai__md to get markdown, then embed_text)
embed_text(slug="docs", texts=[markdown_content])

# 3. Query
chat_with_workspace(slug="docs", message="How do I...", mode="query")
```

#### Pattern 2: Delete a document by docId
```python
# 1. List documents to get docId
list_documents(slug="my-workspace")
# Returns: documents[].docId like "79d25253-a860-4c30-95ab-48d13dd4fd04"

# 2. Delete using docId
delete_document(slug="my-workspace", documentId="79d25253-a860-4c30-95ab-48d13dd4fd04")
```

#### Pattern 3: Clear and recreate workspace
```python
# AnythingLLM doesn't have "clear all docs" - delete and recreate
delete_workspace(slug="old-workspace")
create_workspace(name="old-workspace")  # Fresh start
```

### Important Notes for LLMs

1. **Always initialize first** - Every new session needs `initialize_anythingllm`
2. **Only pass `apiKey` to `initialize_anythingllm`** - The `baseUrl` is set by the host environment (`ANYTHINGLLM_BASE_URL`) and is not a tool argument
3. **Use `mode: "query"` for RAG** - This retrieves relevant documents. `mode: "chat"` doesn't use RAG.
4. **`list_documents` returns docId** - Use this UUID for `delete_document`
5. **No clear chat history API** - Workaround: delete and recreate workspace
6. **Slugs are auto-generated** - When you create "My Workspace", slug becomes "my-workspace"

---

## Bugs Fixed in This Fork

| Bug | Original Behavior | Fixed Behavior |
|-----|-------------------|----------------|
| `list_documents` | Returns empty array `[]` | Returns actual documents |
| `delete_document` | Doesn't delete (wrong API) | Works with docId/filename/docpath |
| `delete_workspace` | JSON parse error on "OK" | Returns `{success: true}` |
| `workspace.workspace` | Assumed object | Handles both array and object |
| Multiple endpoints | Wrong paths | Correct AnythingLLM v1 API paths |

See [Issue #1](https://github.com/raqueljezweb/anythingllm-mcp-server/issues/1) on original repo.

---

## Security Hardening in This Fork

These changes protect the server from prompt-injection and malicious tool arguments:

- **Backend URL is environment-only** — `initialize_anythingllm` no longer accepts a `baseUrl` argument. The server only connects to the URL configured in `ANYTHINGLLM_BASE_URL` at startup, preventing attackers from redirecting API calls (and the API key) to arbitrary servers.
- **Path parameters are encoded** — All `slug`, `userId`, `documentId`, `keyId`, and `agentId` values are URL-encoded before being inserted into API paths, blocking path-traversal attacks like `slug="../admin/users"`.

---

## Installation Options

### Option 1: Clone this fork (Recommended)
```bash
git clone https://github.com/Tapiocapioca/anythingllm-mcp-server.git
cd anythingllm-mcp-server
npm install
```

### Option 2: NPM (Fixed fork published here)
```bash
# Recommended for agents: run from anywhere without installing anything.
# npx fetches and starts the server on demand:
npx -y @telekosmos/anythingllm-mcp-server

# Or install globally:
npm install -g @telekosmos/anythingllm-mcp-server
```
> Requires Node.js 18+ on the host (the `npx` command ships with npm).
> Note: the package `anythingllm-mcp-server` on npm is the buggy upstream and is NOT this fixed fork.

### Option 3: Docker (recommended for multi-container setups)

Build and run the server as a container, either standalone or as part of a
docker-compose stack (AnythingLLM + this MCP server + an MCP client). See the
[Docker](#docker) section below.

---

## Docker

The server ships as a multi-stage `node:22-alpine` image that supports both
transports (stdio and HTTP/SSE). Build it, run it standalone, or use the
provided docker-compose example for a multi-container stack.

### Build the image

```bash
npm run docker:build
# tags the image as anythingllm-mcp-server:<version> and anythingllm-mcp-server:latest
```

### Environment variables

The image reads the same environment variables as the CLI version:

| Variable | Default | Description |
|----------|---------|-------------|
| `ANYTHINGLLM_BASE_URL` | `http://localhost:3001` | AnythingLLM API base URL |
| `ANYTHINGLLM_API_KEY` | *(unset)* | AnythingLLM API key |
| `MCP_TRANSPORT` | `stdio` | Transport to serve: `stdio` or `http` (SSE) |
| `MCP_HOST` | `0.0.0.0` | Bind host for `http` mode |
| `MCP_PORT` | `4001` | Listen port for `http` mode |

### Run in stdio mode (default)

For clients that launch the server as a subprocess (`docker run -i`):

```bash
docker run --rm -i \
  -e ANYTHINGLLM_API_KEY=your-key \
  -e ANYTHINGLLM_BASE_URL=http://localhost:3001 \
  anythingllm-mcp-server:latest
```

### Run in HTTP/SSE mode

Expose the server over the network for other containers or remote clients:

```bash
docker run --rm -p 4001:4001 \
  -e MCP_TRANSPORT=http \
  -e ANYTHINGLLM_BASE_URL=http://localhost:3001 \
  -e ANYTHINGLLM_API_KEY=your-key \
  anythingllm-mcp-server:latest
```

The SSE endpoint is `http://<host>:4001/sse`; clients POST messages to
`/messages?sessionId=...`. Or use the convenience script, which forwards
`ANYTHINGLLM_BASE_URL` and `ANYTHINGLLM_API_KEY` from your shell:

```bash
npm run docker:run
```

> **Note:** from inside a container, `localhost` is the container itself. To
> reach an AnythingLLM instance running on your host, use `host.docker.internal`
> on macOS/Windows, e.g. `ANYTHINGLLM_BASE_URL=http://host.docker.internal:3001`.

### docker-compose

See [`examples/docker-compose.yml`](examples/docker-compose.yml) for a complete
stack: AnythingLLM, this MCP server in SSE mode, and an MCP client (Hermes). It
shows the network wiring (`ANYTHINGLLM_BASE_URL=http://anythingllm:3001`, SSE at
`http://anythingllm-mcp:4001/sse`) and the secrets/placeholders you must replace
before starting:

```bash
docker compose -f examples/docker-compose.yml up
```

### Point an SSE-capable MCP client at the container

For a client that supports remote SSE servers, run the container with
`MCP_TRANSPORT=http` (port 4001 published) and configure:

```json
{
  "mcpServers": {
    "anythingllm": {
      "type": "sse",
      "url": "http://localhost:4001/sse"
    }
  }
}
```

---

## Configuration Examples

### Claude Code (`~/.claude.json`)
```json
{
  "mcpServers": {
    "anythingllm": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@telekosmos/anythingllm-mcp-server"],
      "env": {
        "ANYTHINGLLM_API_KEY": "XXXXX-XXXXXX-XXXXXX-XXXXXXX",
        "ANYTHINGLLM_BASE_URL": "http://localhost:3001"
      }
    }
  }
}
```

### Claude Desktop
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "anythingllm": {
      "command": "npx",
      "args": ["-y", "@telekosmos/anythingllm-mcp-server"],
      "env": {
        "ANYTHINGLLM_API_KEY": "your-key",
        "ANYTHINGLLM_BASE_URL": "http://localhost:3001"
      }
    }
  }
}
```

---

## Troubleshooting

### "Client not initialized" error
→ Call `initialize_anythingllm` with your API key first

### "Workspace not found"
→ Use `list_workspaces` to see available slugs

### Documents not appearing
→ Use `get_workspace` instead of `list_documents` (more reliable)

### Connection refused
→ Ensure AnythingLLM is running on port 3001

---

## Releasing

Releases are automated via GitHub Actions. Publishing happens on every push to `main`: the
publish workflow runs the test suite first, then publishes the package if its version isn't
already on npm (ordinary commits are skipped automatically).

1. Ensure the working tree is clean and your git identity is configured, then bump the version:
   ```bash
   npm version patch   # or minor / major -- also creates a vX.Y.Z git tag
   ```
2. Push to main:
   ```bash
   git push origin main
   ```
3. GitHub Actions runs tests and publishes `@telekosmos/anythingllm-mcp-server` to npm.

**Required GitHub secret:** add an npm automation token (publish scope) as `NPM_TOKEN` in
repo Settings → Secrets and variables → Actions. The publish workflow fails without it.

---

## Security

- Never commit API keys to version control
- Use environment variables for credentials
- API keys can be regenerated in AnythingLLM settings

---

## Credits

- Original: [raqueljezweb/anythingllm-mcp-server](https://github.com/raqueljezweb/anythingllm-mcp-server)
- Fixes: [Tapiocapioca/anythingllm-mcp-server](https://github.com/Tapiocapioca/anythingllm-mcp-server)
- [AnythingLLM](https://anythingllm.com/) by Mintplex Labs
- [Model Context Protocol](https://modelcontext.dev/) by Anthropic
