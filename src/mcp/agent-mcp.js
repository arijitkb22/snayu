/**
 * Per-Agent MCP Server
 * 
 * Exposes each built agent as its own individual MCP server over Streamable HTTP.
 * This allows any IDE to connect to a single agent's MCP endpoint:
 * 
 *   http://localhost:3456/mcp/agents/<agentId>
 * 
 * Each agent MCP server exposes:
 *   1. The agent's own tools (scoped to its tool list)
 *   2. A prompt with the agent's systemPrompt
 *   3. An "execute" tool that runs the agent with a task
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  getAgent as getBuiltAgent,
  listAgents as listBuiltAgents,
  executeAgent,
} from "../core/agent-builder.js";
import {
  collectAllTools,
  executeTool,
} from "../core/adapter-manager.js";

// Cache of active MCP server instances per agent
const agentServers = new Map();

/**
 * Create an MCP server for a single agent
 */
function createAgentMcpServer(agent) {
  const tag = agent.name
    .replace(/[^\w\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();

  const server = new McpServer({
    name: `snayu-agent-${tag}`,
    version: "1.0.0",
    description: agent.description || `Snayu Agent: ${agent.name}`,
    instructions: agent.systemPrompt
      ? `You are the ${agent.name} agent. Follow these instructions:\n\n${agent.systemPrompt.slice(0, 500)}...`
      : undefined,
  });

  // Get all available tools so we can find the ones this agent uses
  const allTools = collectAllTools() || [];
  const agentToolNames = new Set(agent.tools || []);

  // Register each of the agent's tools as an MCP tool
  for (const toolName of agentToolNames) {
    const toolDef = allTools.find(t => t.name === toolName);
    if (!toolDef) continue;

    // Build Zod schema from the tool's inputSchema
    const zodShape = {};
    const props = toolDef.inputSchema?.properties || {};
    const required = new Set(toolDef.inputSchema?.required || []);

    for (const [key, val] of Object.entries(props)) {
      let field;
      if (val.type === "number" || val.type === "integer") {
        field = z.number();
      } else if (val.type === "boolean") {
        field = z.boolean();
      } else if (val.type === "array") {
        field = z.array(z.any());
      } else if (val.type === "object") {
        field = z.record(z.any());
      } else {
        field = z.string();
      }
      if (val.description) field = field.describe(val.description);
      if (!required.has(key)) field = field.optional();
      zodShape[key] = field;
    }

    try {
      server.tool(
        toolName,
        toolDef.description || `Tool: ${toolName}`,
        zodShape,
        async (params) => {
          try {
            const result = await executeTool(toolName, params);
            return {
              content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Error executing ${toolName}: ${err.message}` }],
              isError: true,
            };
          }
        }
      );
    } catch (e) {
      console.error(`[agent-mcp] Could not register tool ${toolName} for ${agent.name}: ${e.message}`);
    }
  }

  // Register a prompt with the agent's system prompt
  if (agent.systemPrompt) {
    try {
      server.prompt(
        tag,
        `Run the ${agent.name} agent`,
        { task: z.string().describe("The task or investigation to perform") },
        (params) => {
          const toolList = [...agentToolNames].map(t => `- \`${t}\``).join("\n");
          return {
            messages: [{
              role: "user",
              content: {
                type: "text",
                text: [
                  agent.systemPrompt,
                  "",
                  "## AVAILABLE TOOLS",
                  toolList,
                  "",
                  "## USER TASK",
                  params.task,
                ].join("\n"),
              },
            }],
          };
        }
      );
    } catch (e) {
      console.error(`[agent-mcp] Could not register prompt for ${agent.name}: ${e.message}`);
    }
  }

  return server;
}

/**
 * Express middleware handler for per-agent MCP endpoints.
 * Mount at /mcp/agents/:agentId
 * 
 * Supports Streamable HTTP (POST for messages, GET for SSE stream, DELETE for session end).
 */
export function handleAgentMcp(req, res) {
  const agentId = req.params.agentId;
  const agent = getBuiltAgent(agentId);
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  // Get or create transport for this session
  const sessionId = req.headers["mcp-session-id"];
  const cacheKey = `${agentId}:${sessionId || "new"}`;

  if (req.method === "POST") {
    handlePost(agentId, agent, req, res);
  } else if (req.method === "GET") {
    handleGet(agentId, agent, req, res);
  } else if (req.method === "DELETE") {
    handleDelete(agentId, req, res);
    } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}

async function handlePost(agentId, agent, req, res) {
  const sessionId = req.headers["mcp-session-id"];

  // If we have an existing transport for this session, reuse it
  if (sessionId && agentServers.has(`${agentId}:${sessionId}`)) {
    const { transport } = agentServers.get(`${agentId}:${sessionId}`);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // Create new MCP server + transport for this agent session
  const server = createAgentMcpServer(agent);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  // Store for reuse
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) agentServers.delete(`${agentId}:${sid}`);
  };

  await server.connect(transport);

  // handleRequest processes the initialize and generates the sessionId
  await transport.handleRequest(req, res, req.body);

  // Cache AFTER handleRequest so sessionId is available
  const sid = transport.sessionId;
  if (sid) {
    agentServers.set(`${agentId}:${sid}`, { server, transport });
  }
}

async function handleGet(agentId, agent, req, res) {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !agentServers.has(`${agentId}:${sessionId}`)) {
    return res.status(400).json({ error: "No active session. Send a POST first to initialize." });
  }
  const { transport } = agentServers.get(`${agentId}:${sessionId}`);
  await transport.handleRequest(req, res);
}

async function handleDelete(agentId, req, res) {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && agentServers.has(`${agentId}:${sessionId}`)) {
    const { transport, server } = agentServers.get(`${agentId}:${sessionId}`);
    await transport.handleRequest(req, res);
    agentServers.delete(`${agentId}:${sessionId}`);
  } else {
    res.status(200).json({ ok: true });
  }
}

/**
 * List all agents with their MCP endpoint URLs
 */
export function listAgentMcpEndpoints(baseUrl) {
  const agents = listBuiltAgents();
  return agents.map(a => {
    const tag = a.name.replace(/[^\w\s]/g, "").trim().replace(/\s+/g, "_").toLowerCase();
    return {
      id: a.id,
      name: a.name,
      tag,
      description: a.description,
      tools: a.tools || [],
      mcpEndpoint: `${baseUrl}/mcp/agents/${a.id}`,
    };
  });
}
