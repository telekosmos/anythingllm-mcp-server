import { createReadStream } from 'node:fs';
import { basename, isAbsolute } from 'node:path';

function validateNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required and must be a non-empty string`);
  }
}

async function uploadFileToWorkspace(client, slug, filePath, folderName) {
  validateNonEmptyString(slug, 'slug');
  validateNonEmptyString(filePath, 'filePath');
  if (!isAbsolute(filePath)) {
    throw new Error('filePath must be an absolute path');
  }
  if (filePath.split(/[\\/]/).includes('..')) {
    throw new Error('filePath must not contain parent directory references');
  }

  let fileStream;
  try {
    fileStream = createReadStream(filePath);
    return await client.uploadDocument(slug, {
      file: fileStream,
      filename: basename(filePath)
    }, folderName);
  } finally {
    fileStream?.destroy();
  }
}

export async function handleAdditionalTools(name, args, client) {
  let result;
  
  switch (name) {
    // User Management
    case 'list_users':
      result = await client.listUsers();
      break;
      
    case 'create_user':
      result = await client.createUser({
        username: args.username,
        password: args.password,
        role: args.role
      });
      break;
      
    case 'update_user':
      result = await client.updateUser(args.userId, args.updates);
      break;
      
    case 'delete_user':
      result = await client.deleteUser(args.userId);
      break;

    // API Key Management
    case 'list_api_keys':
      result = await client.listApiKeys();
      break;
      
    case 'create_api_key':
      result = await client.createApiKey(args.name);
      break;
      
    case 'delete_api_key':
      result = await client.deleteApiKey(args.keyId);
      break;

    // Embedding Management
    case 'embed_text':
      result = await client.embedTextInWorkspace(args.slug, args.texts);
      break;
      
    case 'embed_webpage':
      result = await client.embedWebpage(args.slug, args.url);
      break;

    // Chat History
    case 'get_chat_history':
      result = await client.getWorkspaceChatHistory(args.slug, args.limit || 100);
      break;
      
    case 'clear_chat_history':
      result = await client.clearWorkspaceChatHistory(args.slug);
      break;

    // System Information
    case 'get_system_info':
      result = await client.getSystemInfo();
      break;
      
    case 'get_system_stats':
      result = await client.getSystemStats();
      break;

    // LLM Provider Management
    case 'list_llm_providers':
      result = await client.listLLMProviders();
      break;
      
    case 'update_llm_provider':
      const { provider, ...providerConfig } = args;
      result = await client.updateLLMProvider(provider, providerConfig);
      break;

    // Vector Database Management
    case 'get_vector_database_info':
      result = await client.getVectorDatabaseInfo();
      break;
      
    case 'update_vector_database':
      result = await client.updateVectorDatabase(args.config);
      break;

    // Workspace Settings
    case 'get_workspace_settings':
      result = await client.getWorkspaceSettings(args.slug);
      break;
      
    case 'update_workspace_settings':
      result = await client.updateWorkspaceSettings(args.slug, args.settings);
      break;

    // Document Processing
    case 'process_document_url':
      result = await client.processDocument(args.slug, args.url);
      break;

    case 'upload_file':
      result = await uploadFileToWorkspace(client, args.slug, args.filePath);
      break;

    case 'upload_file_to_folder':
      validateNonEmptyString(args.folderName, 'folderName');
      result = await uploadFileToWorkspace(client, args.slug, args.filePath, args.folderName);
      break;
      
    case 'get_document_vectors':
      result = await client.getDocumentVectors(args.slug, args.documentId);
      break;

    // Search
    case 'search_workspace':
      result = await client.searchWorkspace(args.slug, args.query, args.limit || 10);
      break;

    // Agent Management
    case 'list_agents':
      result = await client.listAgents();
      break;
      
    case 'create_agent':
      result = await client.createAgent({
        name: args.name,
        systemPrompt: args.systemPrompt,
        tools: args.tools
      });
      break;
      
    case 'update_agent':
      result = await client.updateAgent(args.agentId, args.updates);
      break;
      
    case 'delete_agent':
      result = await client.deleteAgent(args.agentId);
      break;
      
    case 'invoke_agent':
      result = await client.invokeAgent(args.agentId, args.input);
      break;

    default:
      return null; // Tool not handled here
  }
  
  return result;
}