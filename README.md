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
      "command": "node",
      "args": ["C:/path/to/anythingllm-mcp-server-fork/src/index.js"],
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

### All Available Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `initialize_anythingllm` | **REQUIRED FIRST** | `apiKey` |
| `list_workspaces` | List all workspaces | - |
| `get_workspace` | Get workspace details + documents | `slug` |
| `create_workspace` | Create new workspace | `name` |
| `update_workspace` | Update workspace settings | `slug`, `updates` |
| `delete_workspace` | Delete workspace | `slug` |
| `embed_text` | Add text to RAG | `slug`, `texts[]` |
| `embed_webpage` | Scrape & add webpage | `slug`, `url` |
| `upload_file` | Upload a local file to RAG | `slug`, `filePath` |
| `upload_file_to_folder` | Upload a local file to a folder | `slug`, `folderName`, `filePath` |
| `list_documents` | List docs in workspace | `slug` |
| `delete_document` | Remove document | `slug`, `documentId` |
| `chat_with_workspace` | Query RAG / Chat | `slug`, `message`, `mode` |
| `search_workspace` | Vector similarity search | `slug`, `query` |
| `get_chat_history` | Get conversation history | `slug` |

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
- **File uploads require absolute paths** — `upload_file` and `upload_file_to_folder` require an absolute `filePath` and reject paths containing `..`. Only files the server process can read are accessible; configure filesystem permissions accordingly.

---

## Installation Options

### Option 1: Clone this fork (Recommended)
```bash
git clone https://github.com/Tapiocapioca/anythingllm-mcp-server.git
cd anythingllm-mcp-server
npm install
```

### Option 2: NPM (Original - HAS BUGS)
```bash
# NOT RECOMMENDED - original package has broken endpoints
npm install -g anythingllm-mcp-server
```

---

## Configuration Examples

### Claude Code (`~/.claude.json`)
```json
{
  "mcpServers": {
    "anythingllm": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/AI/TestVari/anythingllm-mcp-server-fork/src/index.js"],
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
      "command": "node",
      "args": ["/path/to/anythingllm-mcp-server-fork/src/index.js"],
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
