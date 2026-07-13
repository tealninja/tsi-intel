// Minimal MCP dispatcher over JSON-RPC 2.0, for the Streamable HTTP transport.
// Pure and runtime-agnostic (Workers + Node): given a parsed JSON-RPC message and
// a tool list, it returns the JSON-RPC response object (or null for notifications).

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const PROTOCOL_VERSION = '2024-11-05';

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// Cache the derived JSON Schemas so we don't recompute per request.
function toolListPayload(tools) {
  return tools.map((t) => {
    if (!t._jsonSchema) {
      t._jsonSchema = zodToJsonSchema(z.object(t.input), { target: 'jsonSchema7', $refStrategy: 'none' });
    }
    return {
      name: t.name,
      description: t.description,
      inputSchema: { type: 'object', properties: t._jsonSchema.properties || {}, required: t._jsonSchema.required || [] },
    };
  });
}

/**
 * @param message parsed JSON-RPC request/notification
 * @param ctx { tools, serverInfo:{name,version} }
 * @returns response object, or null (notification / no reply)
 */
export async function dispatch(message, ctx) {
  const { tools, serverInfo } = ctx;
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message?.id ?? null, -32600, 'Invalid Request');
  }
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo,
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // notifications get no response

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, { tools: toolListPayload(tools) });

    case 'tools/call': {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const parsed = z.object(tool.input).parse(params?.arguments || {});
        const data = await tool.run(parsed);
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } catch (e) {
        // Tool-level errors are reported as a successful result with isError,
        // per MCP, so the model can see and recover from them.
        return rpcResult(id, { content: [{ type: 'text', text: `Error: ${e.message || e}` }], isError: true });
      }
    }

    default:
      if (isNotification) return null;
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
