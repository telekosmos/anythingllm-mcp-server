import fetch from 'node-fetch';
import FormData from 'form-data';

function safePathSegment(value) {
  if (value === undefined || value === null) {
    throw new Error('Path parameter is required');
  }
  const str = String(value);
  if (str.length === 0) {
    throw new Error('Path parameter must be non-empty');
  }
  return encodeURIComponent(str);
}

export class AnythingLLMClient {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.headers,
        ...options.headers
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`AnythingLLM API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async listWorkspaces() {
    return this.request('/api/v1/workspaces');
  }

  async getWorkspace(slug) {
    return this.request(`/api/v1/workspace/${safePathSegment(slug)}`);
  }

  async createWorkspace(name) {
    return this.request('/api/v1/workspace/new', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
  }

  async updateWorkspace(slug, updates) {
    return this.request(`/api/v1/workspace/${safePathSegment(slug)}/update`, {
      method: 'POST',
      body: JSON.stringify(updates)
    });
  }

  async deleteWorkspace(slug) {
    const url = `${this.baseUrl}/api/v1/workspace/${safePathSegment(slug)}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.headers
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`AnythingLLM API error: ${response.status} - ${error}`);
    }

    // AnythingLLM returns plain text "OK" instead of JSON for delete
    const text = await response.text();
    return { success: text === 'OK', message: text };
  }

  async chatWithWorkspace(slug, message, mode = 'chat') {
    return this.request(`/api/v1/workspace/${safePathSegment(slug)}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message, mode })
    });
  }

  async streamChatWithWorkspace(slug, message, mode = 'chat') {
    const url = `${this.baseUrl}/api/v1/workspace/${safePathSegment(slug)}/stream-chat`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ message, mode })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`AnythingLLM API error: ${response.status} - ${error}`);
    }

    return response.body;
  }

  // FIXED: Upload document to system documents, then add to workspace
  // AnythingLLM requires a two-step process:
  // 1. Upload file to /api/v1/document/upload
  // 2. Add to workspace with /api/v1/workspace/{slug}/update-embeddings
  async uploadDocument(workspaceSlug, documentData) {
    const formData = new FormData();
    formData.append('file', documentData.file, documentData.filename || 'document');

    // Step 1: Upload to system documents
    const uploadResponse = await fetch(`${this.baseUrl}/api/v1/document/upload`, {
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

  // FIXED: List documents - use system endpoint or workspace details
  async listDocuments(workspaceSlug) {
    if (workspaceSlug) {
      // Get workspace details which includes embedded documents
      const workspace = await this.request(`/api/v1/workspace/${safePathSegment(workspaceSlug)}`);
      // Note: workspace.workspace can be an array or object depending on API version
      const wsData = Array.isArray(workspace.workspace) ? workspace.workspace[0] : workspace.workspace;
      return { documents: wsData?.documents || [] };
    }
    // List all system documents
    return this.request('/api/v1/documents');
  }

  // FIXED: Delete document from workspace
  // The documentName can be docId, filename, or full docpath
  async deleteDocument(workspaceSlug, documentName) {
    if (documentName === undefined || documentName === null || String(documentName).length === 0) {
      throw new Error('documentName is required and must be non-empty');
    }
    const workspace = await this.getWorkspace(workspaceSlug);
    // Note: workspace.workspace can be an array or object depending on API version
    const wsData = Array.isArray(workspace.workspace) ? workspace.workspace[0] : workspace.workspace;
    const docs = wsData?.documents || [];
    let docPath = documentName;
    const matchedDoc = docs.find(d =>
      d.docId === documentName ||
      d.filename === documentName ||
      d.docpath === documentName ||
      d.docpath?.includes(documentName)
    );
    if (matchedDoc) { docPath = matchedDoc.docpath; }
    return this.request(`/api/v1/workspace/${safePathSegment(workspaceSlug)}/update-embeddings`, {
      method: 'POST',
      body: JSON.stringify({ deletes: [docPath] })
    });
  }

  // Helper: Add documents to workspace by their location paths
  async addDocumentsToWorkspace(workspaceSlug, documentPaths) {
    return this.request(`/api/v1/workspace/${safePathSegment(workspaceSlug)}/update-embeddings`, {
      method: 'POST',
      body: JSON.stringify({
        adds: documentPaths
      })
    });
  }

  async getSystemSettings() {
    return this.request('/api/v1/admin/system-preferences');
  }

  async updateSystemSettings(settings) {
    return this.request('/api/v1/admin/system-preferences', {
      method: 'POST',
      body: JSON.stringify(settings)
    });
  }

  // User Management
  async listUsers() {
    return this.request('/api/v1/admin/users');
  }

  async createUser(userData) {
    return this.request('/api/v1/admin/users/new', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
  }

  async updateUser(userId, updates) {
    return this.request(`/api/v1/admin/users/${safePathSegment(userId)}`, {
      method: 'POST',
      body: JSON.stringify(updates)
    });
  }

  async deleteUser(userId) {
    return this.request(`/api/v1/admin/users/${safePathSegment(userId)}`, {
      method: 'DELETE'
    });
  }

  // API Key Management
  async listApiKeys() {
    return this.request('/api/v1/admin/api-keys');
  }

  async createApiKey() {
    return this.request('/api/v1/admin/generate-api-key', {
      method: 'POST'
    });
  }

  async deleteApiKey(keyId) {
    return this.request(`/api/v1/admin/delete-api-key/${safePathSegment(keyId)}`, {
      method: 'DELETE'
    });
  }

  // FIXED: Embedding Management - two-step process
  // 1. Create document with raw text via /api/v1/document/raw-text
  // 2. Add to workspace via /api/v1/workspace/{slug}/update-embeddings
  async embedTextInWorkspace(workspaceSlug, texts) {
    const results = [];

    // Process each text as a separate document
    const textsArray = Array.isArray(texts) ? texts : [texts];

    for (let i = 0; i < textsArray.length; i++) {
      const text = textsArray[i];
      const title = `embedded-text-${Date.now()}-${i}`;

      // Step 1: Create document from raw text
      const docResponse = await this.request('/api/v1/document/raw-text', {
        method: 'POST',
        body: JSON.stringify({
          textContent: text,
          metadata: {
            title: title,
            docSource: 'mcp-embedded'
          }
        })
      });

      results.push(docResponse);

      // Step 2: Add to workspace if document was created
      if (docResponse.success && docResponse.documents) {
        const docPaths = docResponse.documents.map(doc => doc.location);
        await this.addDocumentsToWorkspace(workspaceSlug, docPaths);
      }
    }

    return { success: true, documents: results };
  }

  // FIXED: Embed webpage - use document/upload-link then add to workspace
  async embedWebpage(workspaceSlug, url) {
    // Step 1: Fetch and process the link
    const linkResponse = await this.request('/api/v1/document/upload-link', {
      method: 'POST',
      body: JSON.stringify({ link: url })
    });

    // Step 2: Add to workspace if successful
    if (linkResponse.success && linkResponse.documents) {
      const docPaths = linkResponse.documents.map(doc => doc.location);
      await this.addDocumentsToWorkspace(workspaceSlug, docPaths);
    }

    return linkResponse;
  }

  // Chat History
  async getWorkspaceChatHistory(workspaceSlug, limit = 100) {
    return this.request(`/api/v1/workspace/${safePathSegment(workspaceSlug)}/chats`);
  }

  // NOTE: AnythingLLM API v1 does not have endpoint to clear chat history
  async clearWorkspaceChatHistory(workspaceSlug) {
    throw new Error(
      'AnythingLLM API v1 does not support clearing chat history. ' +
      'Workaround: Delete and recreate the workspace.'
    );
  }

  // System Information
  async getSystemInfo() {
    return this.request('/api/v1/system/env-dump');
  }

  async getSystemStats() {
    return this.request('/api/v1/system/system-vectors');
  }

  // LLM Provider Management - Note: These are admin endpoints
  async listLLMProviders() {
    // AnythingLLM doesn't have a direct endpoint for this,
    // but we can get current config from system preferences
    return this.request('/api/v1/admin/system-preferences');
  }

  async updateLLMProvider(provider, config) {
    return this.request('/api/v1/admin/system-preferences', {
      method: 'POST',
      body: JSON.stringify({
        LLMProvider: provider,
        ...config
      })
    });
  }

  // Vector Database Management
  async getVectorDatabaseInfo() {
    return this.request('/api/v1/admin/system-preferences');
  }

  async updateVectorDatabase(config) {
    return this.request('/api/v1/admin/system-preferences', {
      method: 'POST',
      body: JSON.stringify({
        VectorDB: config.provider,
        ...config
      })
    });
  }

  // Workspace Settings - get workspace details
  async getWorkspaceSettings(workspaceSlug) {
    return this.request(`/api/v1/workspace/${safePathSegment(workspaceSlug)}`);
  }

  async updateWorkspaceSettings(workspaceSlug, settings) {
    return this.request(`/api/v1/workspace/${safePathSegment(workspaceSlug)}/update`, {
      method: 'POST',
      body: JSON.stringify(settings)
    });
  }

  // Document Processing via URL
  async processDocument(workspaceSlug, documentUrl) {
    return this.embedWebpage(workspaceSlug, documentUrl);
  }

  // Get document vectors - through workspace vector search
  async getDocumentVectors(workspaceSlug, documentId) {
    // AnythingLLM doesn't expose individual document vectors directly
    // Use vector search as a workaround
    return this.request(`/api/v1/workspace/${safePathSegment(workspaceSlug)}/vector-search`, {
      method: 'POST',
      body: JSON.stringify({
        query: '',
        topK: 100
      })
    });
  }

  // Search - use vector search endpoint
  async searchWorkspace(workspaceSlug, query, limit = 10) {
    return this.request(`/api/v1/workspace/${safePathSegment(workspaceSlug)}/vector-search`, {
      method: 'POST',
      body: JSON.stringify({
        query: query,
        topK: limit
      })
    });
  }

  // Agents - AnythingLLM has workspace agents, not standalone
  async listAgents() {
    // Agents are per-workspace in AnythingLLM
    // Return workspace list with agent config
    const workspaces = await this.listWorkspaces();
    return {
      message: 'Agents are configured per-workspace in AnythingLLM',
      workspaces: workspaces
    };
  }

  async createAgent(agentData) {
    // Agent creation is done via workspace settings
    if (!agentData.workspaceSlug) {
      throw new Error('workspaceSlug is required to create an agent');
    }
    return this.request(`/api/v1/workspace/${safePathSegment(agentData.workspaceSlug)}/update`, {
      method: 'POST',
      body: JSON.stringify({
        agentProvider: agentData.provider || 'none',
        agentModel: agentData.model,
        ...agentData
      })
    });
  }

  async updateAgent(agentId, updates) {
    // agentId should be the workspace slug
    return this.request(`/api/v1/workspace/${safePathSegment(agentId)}/update`, {
      method: 'POST',
      body: JSON.stringify(updates)
    });
  }

  async deleteAgent(agentId) {
    // Disable agent on workspace
    return this.request(`/api/v1/workspace/${safePathSegment(agentId)}/update`, {
      method: 'POST',
      body: JSON.stringify({ agentProvider: 'none' })
    });
  }

  async invokeAgent(agentId, input) {
    // Use chat with agent mode
    return this.request(`/api/v1/workspace/${safePathSegment(agentId)}/chat`, {
      method: 'POST',
      body: JSON.stringify({
        message: input,
        mode: 'chat',
        attachments: []
      })
    });
  }
}
