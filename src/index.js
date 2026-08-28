#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import { AnythingLLMClient } from './client.js';
import { additionalTools } from './additional-tools.js';
import { handleAdditionalTools } from './additional-handlers.js';

function validateBaseUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('baseUrl must use http or https');
    }
    if (url.username || url.password) {
      throw new Error('baseUrl must not contain credentials');
    }
    return urlString.replace(/\/$/, '');
  } catch (error) {
    throw new Error(`Invalid ANYTHINGLLM_BASE_URL "${urlString}": ${error.message}`);
  }
}

const DEFAULT_MCP_HOST = '0.0.0.0';
const DEFAULT_MCP_PORT = 4001;

function resolveTransportConfig(env) {
  const mode = env.MCP_TRANSPORT || 'stdio';
  if (mode !== 'stdio' && mode !== 'http') {
    throw new Error(`Invalid MCP_TRANSPORT "${mode}": expected "stdio" or "http"`);
  }
  const host = env.MCP_HOST || DEFAULT_MCP_HOST;
  const rawPort = env.MCP_PORT || DEFAULT_MCP_PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid MCP_PORT "${rawPort}": expected a port number between 1 and 65535`);
  }
  return { mode, host, port };
}

async function startHttpTransport(config) {
  const sessions = new Map();

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/sse') {
        const server = createMcpServer();
        const transport = new SSEServerTransport('/messages', res);
        const sessionId = transport.sessionId;
        sessions.set(sessionId, { server, transport });
        transport.onclose = () => {
          sessions.delete(sessionId);
        };
        try {
          await server.connect(transport);
        } catch (error) {
          sessions.delete(sessionId);
          throw error;
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/messages') {
        const sessionId = url.searchParams.get('sessionId');
        const entry = sessionId && sessions.get(sessionId);
        if (!entry) {
          res.writeHead(400).end('Unknown session');
          return;
        }
        await entry.transport.handlePostMessage(req, res);
        return;
      }

      res.writeHead(404).end('Not found');
    } catch (error) {
      console.error('HTTP transport error:', error);
      if (!res.headersSent) {
        res.writeHead(500).end(String(error.message || error));
      }
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, resolve);
  });
  console.error(
    `AnythingLLM MCP Server (SSE) listening on http://${config.host}:${config.port}/sse`
  );
}

const DEFAULT_BASE_URL = 'http://localhost:3001';
const configuredBaseUrl = validateBaseUrl(process.env.ANYTHINGLLM_BASE_URL || DEFAULT_BASE_URL);

let client = null;
let config = {
  apiKey: process.env.ANYTHINGLLM_API_KEY || null,
  baseUrl: configuredBaseUrl
};

// Auto-initialize if the API key is provided via environment.
// This lets the server work immediately without requiring the
// initialize_anythingllm tool call for every new session.
if (config.apiKey) {
  client = new AnythingLLMClient(config.baseUrl, config.apiKey);
}

function createMcpServer() {
  const server = new Server(
    {
      name: 'anythingllm-mcp-server',
      vendor: 'anythingllm',
      version: '2.0.0',
      description: 'MCP server for AnythingLLM integration'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );
  
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'initialize_anythingllm',
          description: 'Initialize the AnythingLLM client with API credentials',
          inputSchema: {
            type: 'object',
            properties: {
              apiKey: {
                type: 'string',
                description: 'Your AnythingLLM API key (optional if ANYTHINGLLM_API_KEY env var is set)'
              }
            },
            required: []
          }
        },
        {
          name: 'list_workspaces',
          description: 'List all available workspaces in AnythingLLM',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_workspace',
          description: 'Get details of a specific workspace',
          inputSchema: {
            type: 'object',
            properties: {
              slug: {
                type: 'string',
                description: 'The workspace slug/identifier'
              }
            },
            required: ['slug']
          }
        },
        {
          name: 'create_workspace',
          description: 'Create a new workspace',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name of the new workspace'
              }
            },
            required: ['name']
          }
        },
        {
          name: 'update_workspace',
          description: 'Update an existing workspace',
          inputSchema: {
            type: 'object',
            properties: {
              slug: {
                type: 'string',
                description: 'The workspace slug/identifier'
              },
              updates: {
                type: 'object',
                description: 'Object containing fields to update'
              }
            },
            required: ['slug', 'updates']
          }
        },
        {
          name: 'delete_workspace',
          description: 'Delete a workspace',
          inputSchema: {
            type: 'object',
            properties: {
              slug: {
                type: 'string',
                description: 'The workspace slug/identifier'
              }
            },
            required: ['slug']
          }
        },
        {
          name: 'chat_with_workspace',
          description: 'Send a chat message to a workspace',
          inputSchema: {
            type: 'object',
            properties: {
              slug: {
                type: 'string',
                description: 'The workspace slug/identifier'
              },
              message: {
                type: 'string',
                description: 'The message to send'
              },
              mode: {
                type: 'string',
                description: 'Chat mode (chat or query)',
                enum: ['chat', 'query'],
                default: 'chat'
              }
            },
            required: ['slug', 'message']
          }
        },
        {
          name: 'list_documents',
          description: 'List all documents in a workspace',
          inputSchema: {
            type: 'object',
            properties: {
              slug: {
                type: 'string',
                description: 'The workspace slug/identifier'
              }
            },
            required: ['slug']
          }
        },
        {
          name: 'delete_document',
          description: 'Delete a document from a workspace',
          inputSchema: {
            type: 'object',
            properties: {
              slug: {
                type: 'string',
                description: 'The workspace slug/identifier'
              },
              documentId: {
                type: 'string',
                description: 'The document ID to delete'
              }
            },
            required: ['slug', 'documentId']
          }
        },
        {
          name: 'get_system_settings',
          description: 'Get system settings',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'update_system_settings',
          description: 'Update system settings',
          inputSchema: {
            type: 'object',
            properties: {
              settings: {
                type: 'object',
                description: 'Settings object to update'
              }
            },
            required: ['settings']
          }
        },
        ...additionalTools
      ]
    };
  });
  
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
  
    try {
      let result;
      
      switch (name) {
        case 'initialize_anythingllm': {
          const apiKey = args.apiKey || config.apiKey;
          if (!apiKey || typeof apiKey !== 'string') {
            throw new Error('apiKey is required; set ANYTHINGLLM_API_KEY or pass it to initialize_anythingllm');
          }
          config.apiKey = apiKey;
          client = new AnythingLLMClient(config.baseUrl, config.apiKey);
          result = { 
            message: 'AnythingLLM client initialized successfully',
            baseUrl: config.baseUrl 
          };
          break;
        }
          
        case 'list_workspaces':
          if (!client) {
            throw new Error('AnythingLLM client not initialized. Please run initialize_anythingllm first.');
          }
          result = await client.listWorkspaces();
          break;
          
        case 'get_workspace':
          if (!client) {
            throw new Error('AnythingLLM client not initialized. Please run initialize_anythingllm first.');
          }
          result = await client.getWorkspace(args.slug);
          break;
          
        case 'create_workspace':
          if (!client) {
            throw new Error('AnythingLLM client not initialized. Please run initialize_anythingllm first.');
          }
          result = await client.createWorkspace(args.name);
          break;
          
        case 'update_workspace':
          if (!client) {
            throw new Error('AnythingLLM client not initialized. Please run initialize_anythingllm first.');
          }
          result = await client.updateWorkspace(args.slug, args.updates);
          break;
          
        case 'delete_workspace':
          if (!client) {
            throw new Error('AnythingLLM client not initialized. Please run initialize_anythingllm first.');
          }
          result = await client.deleteWorkspace(args.slug);
          break;
          
        case 'chat_with_workspace':
          if (!client) {
            throw new Error('AnythingLLM client not initialized. Please run initialize_anythingllm first.');
          }
          result = await client.chatWithWorkspace(args.slug, args.message, args.mode || 'chat');
          break;
          
        case 'list_documents':
          if (!client) {
            throw new Error('AnythingLLM client not initialized. Please run initialize_anythingllm first.');
          }
          result = await client.listDocuments(args.slug);
          break;
          
        case 'delete_document':
          if (!client) {
            throw new Error('AnythingLLM client not initialized. Please run initialize_anythingllm first.');
          }
          result = await client.deleteDocument(args.slug, args.documentId);
          break;
          
        case 'get_system_settings':
          if (!client) {
            throw new Error('AnythingLLM client not initialized. Please run initialize_anythingllm first.');
          }
          result = await client.getSystemSettings();
          break;
          
        case 'update_system_settings':
          if (!client) {
            throw new Error('AnythingLLM client not initialized. Please run initialize_anythingllm first.');
          }
          result = await client.updateSystemSettings(args.settings);
          break;
          
        default:
          // Try additional tools
          if (!client) {
            throw new Error('AnythingLLM client not initialized. Please run initialize_anythingllm first.');
          }
          result = await handleAdditionalTools(name, args, client);
          if (result === null) {
            throw new Error(`Unknown tool: ${name}`);
          }
      }
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`
          }
        ],
        isError: true
      };
    }
  });
  return server;
}

async function main() {
  const transportConfig = resolveTransportConfig(process.env);
  if (transportConfig.mode === 'http') {
    await startHttpTransport(transportConfig);
  } else {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('AnythingLLM MCP Server started');
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}

export { validateBaseUrl, resolveTransportConfig };