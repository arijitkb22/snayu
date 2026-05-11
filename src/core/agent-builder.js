/**
 * Agent Builder — Create AI Agents from Snayu Connectors
 * 
 * Allows users to declaratively compose agents by selecting:
 * - Which tools (from adapters) the agent can use
 * - A system prompt / instruction set
 * - Trigger type (manual, webhook, schedule)
 * - Optional LLM backend for autonomous execution
 * 
 * Agents are stored as JSON definitions and can be:
 * - Executed manually via API
 * - Triggered by webhooks
 * - Exported as standalone MCP servers
 * - Shared across orgs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { collectAllTools, executeTool } from "./adapter-manager.js";
import { onboardAgent, removeRegistryAgent, getAllRegistryAgents } from "./agent-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_FILE = path.resolve(__dirname, "../../data/built-agents.json");

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadAgents() {
  try {
    if (fs.existsSync(AGENTS_FILE)) {
      return JSON.parse(fs.readFileSync(AGENTS_FILE, "utf-8"));
    }
  } catch (_) {}
  return {};
}

function saveAgents(agents) {
  const dir = path.dirname(AGENTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2));
}

// ─── Agent Definition Schema ─────────────────────────────────────────────────

/**
 * Agent Definition:
 * {
 *   id: "agent-uuid",
 *   name: "Incident Responder",
 *   description: "Monitors alerts and creates tickets",
 *   systemPrompt: "You are an incident response agent...",
 *   tools: ["cloudwatch_get_alarms", "slack_send_message", "github_create_issue"],
 *   trigger: { type: "manual" | "webhook" | "schedule", config: {} },
 *   llm: { provider: "openai" | "anthropic" | "azure" | "none", model: "gpt-4o", apiKey: "env:OPENAI_API_KEY" },
 *   createdAt: "ISO date",
 *   updatedAt: "ISO date",
 *   status: "active" | "draft" | "disabled"
 * }
 */

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function createAgent(definition) {
  const errors = validateDefinition(definition);
  if (errors.length > 0) return { success: false, errors };

  const agents = loadAgents();
  const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const agent = {
    id,
    name: definition.name.trim(),
    description: definition.description?.trim() || "",
    systemPrompt: definition.systemPrompt || definition.prompt || "",
    tools: definition.tools || [],
    trigger: definition.trigger || { type: "manual" },
    llm: definition.llm || { provider: "none" },
    variables: definition.variables || {},
    steps: definition.steps || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
    executions: 0,
    lastExecution: null,
  };

  agents[id] = agent;
  saveAgents(agents);

  // Auto-register in Agent Registry so it appears in MCP for Copilot/Claude
  autoRegisterInRegistry(agent);

  return { success: true, agent };
}

export function updateAgent(id, updates) {
  const agents = loadAgents();
  if (!agents[id]) return { success: false, errors: ["Agent not found"] };

  const allowed = ["name", "description", "systemPrompt", "tools", "trigger", "llm", "variables", "steps", "status"];
  for (const key of allowed) {
    if (updates[key] !== undefined) agents[id][key] = updates[key];
  }
  agents[id].updatedAt = new Date().toISOString();

  saveAgents(agents);
  return { success: true, agent: agents[id] };
}

export function deleteAgent(id) {
  const agents = loadAgents();
  if (!agents[id]) return { success: false, errors: ["Agent not found"] };
  // Remove from Agent Registry
  const registryId = agents[id]._registryId;
  if (registryId) { try { removeRegistryAgent(registryId); } catch (_) {} }
  delete agents[id];
  saveAgents(agents);
  return { success: true };
}

export function getAgent(id) {
  return loadAgents()[id] || null;
}

export function listAgents() {
  return Object.values(loadAgents() || {});
}

// ─── Auto-Register in Agent Registry ─────────────────────────────────────────

function autoRegisterInRegistry(agent) {
  try {
    const PORT = process.env.PORT || 3456;
    const manifest = {
      name: agent.name,
      description: agent.description || `Built agent: ${agent.name}`,
      author: "Snayu Agent Builder",
      version: "1.0.0",
      endpoint: `http://localhost:${PORT}/api/builder/agents/${agent.id}/execute`,
      protocol: "http",
      tools: agent.tools.map(t => ({
        name: t,
        description: `Tool: ${t} (via ${agent.name})`,
      })),
    };
    const result = onboardAgent(manifest);
    if (result?.ok && result.agent?.id) {
      // Store registry ID for cleanup on delete
      const agents = loadAgents();
      if (agents[agent.id]) {
        agents[agent.id]._registryId = result.agent.id;
        saveAgents(agents);
      }
    }
  } catch (e) {
    // Non-blocking — agent still works even if registry fails
    console.error(`[agent-builder] Auto-register failed for "${agent.name}": ${e.message}`);
  }
}

// ─── Startup Sync — ensure all built agents are in the registry ──────────────

export function syncRegistryOnStartup() {
  try {
    const agents = loadAgents();
    const registry = getAllRegistryAgents();
    const registeredEndpoints = new Set(registry.map(r => r.endpoint));
    const PORT = process.env.PORT || 3456;
    let synced = 0;

    for (const [id, agent] of Object.entries(agents)) {
      const endpoint = `http://localhost:${PORT}/api/builder/agents/${id}/execute`;
      // Skip if already registered
      if (agent._registryId || registeredEndpoints.has(endpoint)) continue;
      autoRegisterInRegistry({ ...agent, id });
      synced++;
    }

    if (synced > 0) {
      console.log(`[agent-builder] Synced ${synced} agents to registry on startup`);
    }
  } catch (e) {
    console.error(`[agent-builder] Registry sync failed: ${e.message}`);
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateDefinition(def) {
  const errors = [];
  if (!def.name || def.name.trim().length === 0) errors.push("'name' is required");
  if (!def.tools || !Array.isArray(def.tools) || def.tools.length === 0) {
    errors.push("At least one tool must be selected");
  }

  // Note: we don't validate tool names strictly — tools may reference
  // services not yet connected (templates, cross-org tools, etc.)

  if (def.trigger && !["manual", "webhook", "schedule"].includes(def.trigger.type)) {
    errors.push("trigger.type must be 'manual', 'webhook', or 'schedule'");
  }
  return errors;
}

// ─── Execution Engine ────────────────────────────────────────────────────────

/**
 * Execute an agent — runs its tool chain with provided input.
 * 
 * For agents with llm.provider = "none", it runs the steps sequentially.
 * For agents with an LLM, it sends the system prompt + input to the LLM
 * and lets it decide which tools to call (ReAct loop).
 */
export async function executeAgent(agentId, input = {}) {
  const agents = loadAgents();
  const agent = agents[agentId];
  if (!agent) return { success: false, error: "Agent not found" };
  if (agent.status === "disabled") return { success: false, error: "Agent is disabled" };

  const startTime = Date.now();
  const results = [];

  try {
    if (agent.steps && agent.steps.length > 0) {
      // Sequential step execution (no LLM needed)
      for (const step of agent.steps) {
        const params = resolveParams(step.params, input, results);
        const result = await executeTool(step.tool, params);
        results.push({ step: step.name || step.tool, result, success: true });
      }
    } else if (agent.llm && agent.llm.provider !== "none") {
      // LLM-driven execution (ReAct loop)
      const llmResult = await executeLLMAgent(agent, input);
      results.push(...llmResult);
    } else {
      // ─── Smart Execution Mode ────────────────────────────────────────
      // 2-phase intelligent execution:
      //   Phase 1: Run discovery tools to gather context
      //   Phase 2: Use discovered data to feed detail tools with proper params
      //   Phase 3: Compose summary and send to output tools
      const outputToolPatterns = ["send_message", "send_card", "send_notification"];
      const isOutputTool = (name) => outputToolPatterns.some(p => name.includes(p));

      const dataTools = agent.tools.filter(t => !isOutputTool(t));
      const outTools  = agent.tools.filter(t => isOutputTool(t));

      // Parse user input for context clues
      const userInput = typeof input === "string" ? input : (input.input || JSON.stringify(input));
      const context = parseUserContext(userInput, dataTools);

      // Classify tools into discovery (no required params) vs detail (need params)
      const { discoveryTools, detailTools } = classifyTools(dataTools);

      // Phase 1: Run discovery tools
      for (const toolName of discoveryTools) {
        try {
          const params = buildSmartParams(toolName, context, results);
          const result = await executeTool(toolName, params);
          results.push({ tool: toolName, result, success: true });
        } catch (err) {
          results.push({ tool: toolName, error: err.message, success: false });
        }
      }

      // Extract discovered data to enrich context
      enrichContextFromResults(context, results);

      // Phase 2: Run detail tools with enriched params
      for (const toolName of detailTools) {
        try {
          // Re-enrich before each detail tool so earlier detail results feed later ones
          enrichContextFromResults(context, results);
          const params = buildSmartParams(toolName, context, results);
          if (params._skip) {
            results.push({ tool: toolName, result: { skipped: true, reason: params._skipReason }, success: true });
            continue;
          }
          const result = await executeTool(toolName, params);
          results.push({ tool: toolName, result, success: true });
        } catch (err) {
          results.push({ tool: toolName, error: err.message, success: false });
        }
      }

      // Phase 3: Compose summary and send to output tools
      if (outTools.length > 0) {
        const summaryLines = results
          .filter(r => !r.result?.skipped)
          .map(r => {
            const label = (r.tool || r.step || "").split("__").pop();
            if (!r.success) return `❌ **${label}**: ${r.error}`;
            const text = extractResultText(r.result);
            if (!text) return `✅ **${label}**: (empty)`;
            // Truncate very long results for the card
            const truncated = text.length > 1500 ? text.substring(0, 1500) + "\n...(truncated)" : text;
            return `✅ **${label}**:\n${truncated}`;
          });
        const summaryText = summaryLines.join("\n\n---\n\n");
        const title = `${agent.name} — Report`;

        for (const toolName of outTools) {
          try {
            const isCard = toolName.includes("send_card");
            const params = isCard
              ? { summary: title, title, text: summaryText || "(no data collected)" }
              : { text: summaryText || "(no data collected)", title };
            const result = await executeTool(toolName, params);
            results.push({ tool: toolName, result, success: true });
          } catch (err) {
            results.push({ tool: toolName, error: err.message, success: false });
          }
        }
      }
    }

    // Update execution stats
    agents[agentId].executions = (agents[agentId].executions || 0) + 1;
    agents[agentId].lastExecution = new Date().toISOString();
    saveAgents(agents);

    return {
      success: true,
      agentId,
      duration: Date.now() - startTime,
      results,
    };
  } catch (err) {
    return { success: false, error: err.message, results };
  }
}

// ─── Parameter Resolution ────────────────────────────────────────────────────

/**
 * Resolves step params with template variables.
 * Supports: {{input.field}}, {{steps[0].result.field}}, {{env.VAR}}
 */
function resolveParams(params, input, previousResults) {
  if (!params) return input;

  const resolved = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.startsWith("{{") && value.endsWith("}}")) {
      const expr = value.slice(2, -2).trim();
      if (expr.startsWith("input.")) {
        resolved[key] = input[expr.slice(6)];
      } else if (expr.startsWith("steps[")) {
        const match = expr.match(/steps\[(\d+)\]\.result\.(.+)/);
        if (match) {
          const idx = parseInt(match[1]);
          const field = match[2];
          resolved[key] = previousResults[idx]?.result?.[field];
        }
      } else if (expr.startsWith("env.")) {
        resolved[key] = process.env[expr.slice(4)];
      } else {
        resolved[key] = value;
      }
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

// ─── LLM Agent Execution (ReAct Loop) ───────────────────────────────────────

async function executeLLMAgent(agent, input) {
  const results = [];
  const { provider, model, apiKey } = agent.llm;

  // Resolve API key from env if needed
  const resolvedKey = apiKey?.startsWith("env:")
    ? process.env[apiKey.slice(4)]
    : apiKey;

  if (!resolvedKey) {
    results.push({ error: `No API key configured for ${provider}`, success: false });
    return results;
  }

  // Build available tools description for the LLM
  const allTools = collectAllTools();
  const agentTools = allTools.filter(t => agent.tools.includes(t.name));
  const toolsDesc = agentTools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema || {} }
  }));

  const messages = [
    { role: "system", content: agent.systemPrompt || "You are a helpful agent. Use the provided tools to accomplish the user's task." },
    { role: "user", content: typeof input === "string" ? input : JSON.stringify(input) }
  ];

  // ReAct loop (max 10 iterations)
  for (let i = 0; i < 10; i++) {
    const response = await callLLM(provider, model, resolvedKey, messages, toolsDesc);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      // LLM is done — return final answer
      results.push({ type: "answer", content: response.content, success: true });
      break;
    }

    // Execute tool calls
    for (const call of response.tool_calls) {
      try {
        const params = JSON.parse(call.function.arguments || "{}");
        const result = await executeTool(call.function.name, params);
        results.push({ tool: call.function.name, result, success: true });
        messages.push({ role: "assistant", content: null, tool_calls: [call] });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      } catch (err) {
        results.push({ tool: call.function.name, error: err.message, success: false });
        messages.push({ role: "tool", tool_call_id: call.id, content: `Error: ${err.message}` });
      }
    }
  }

  return results;
}

async function callLLM(provider, model, apiKey, messages, tools) {
  const endpoints = {
    openai: "https://api.openai.com/v1/chat/completions",
    anthropic: "https://api.anthropic.com/v1/messages",
    azure: process.env.AZURE_OPENAI_ENDPOINT,
  };

  const url = endpoints[provider];
  if (!url) throw new Error(`Unsupported LLM provider: ${provider}`);

  if (provider === "openai" || provider === "azure") {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "LLM call failed");
    return data.choices[0].message;
  }

  if (provider === "anthropic") {
    const systemMsg = messages.find(m => m.role === "system");
    const otherMsgs = messages.filter(m => m.role !== "system");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: systemMsg?.content || "",
        messages: otherMsgs,
        tools: tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })),
        max_tokens: 4096,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Anthropic call failed");

    // Normalize Anthropic response to OpenAI format
    const toolUseBlocks = data.content.filter(b => b.type === "tool_use");
    const textBlocks = data.content.filter(b => b.type === "text");
    return {
      content: textBlocks.map(b => b.text).join("\n"),
      tool_calls: toolUseBlocks.map(b => ({
        id: b.id,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      })),
    };
  }
}

// ─── Export as MCP Server ────────────────────────────────────────────────────

/**
 * Generate a standalone MCP server config for a built agent.
 * This lets the agent be used directly by Claude/Copilot as a single tool.
 */
export function exportAgentAsMCPTool(agentId) {
  const agent = getAgent(agentId);
  if (!agent) return null;

  return {
    name: agent.name.toLowerCase().replace(/\s+/g, "_"),
    description: agent.description || `Execute the ${agent.name} agent`,
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "The task or query for this agent" },
      },
      required: ["input"],
    },
    _agentId: agentId,
  };
}

// ─── Webhook Handler ─────────────────────────────────────────────────────────

export async function handleWebhook(agentId, payload) {
  const agent = getAgent(agentId);
  if (!agent) return { success: false, error: "Agent not found" };
  if (agent.trigger?.type !== "webhook") {
    return { success: false, error: "Agent is not configured for webhook triggers" };
  }
  return executeAgent(agentId, payload);
}

// ─── Available Tools (for UI) ────────────────────────────────────────────────

export function getAvailableTools() {
  const tools = collectAllTools() || [];
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    service: t._service || "unknown",
  }));
}

// ─── Expose Built Agents as MCP Tools ────────────────────────────────────────

/**
 * Returns an array of MCP-compatible tool definitions — one per built agent.
// ─── Smart Execution Helpers ─────────────────────────────────────────────────

/**
 * Parse user input for context clues — extract log group names, namespaces,
 * table names, SQL queries, bucket names, etc.
 */
function parseUserContext(userInput, tools) {
  const ctx = { raw: userInput, params: {} };
  const input = userInput.toLowerCase();

  // CloudWatch log groups
  const logGroupMatch = userInput.match(/(?:log\s*group|\/aws\/\S+)/gi);
  if (logGroupMatch) {
    const groups = logGroupMatch.map(g => g.startsWith("/") ? g : null).filter(Boolean);
    if (groups.length > 0) ctx.params.logGroupName = groups[0];
  }

  // AWS namespace (e.g., AWS/EC2, AWS/Lambda, AWS/RDS)
  const nsMatch = userInput.match(/\b(AWS\/\w+)\b/gi);
  if (nsMatch) ctx.params.namespace = nsMatch[0];

  // DynamoDB table name
  const tableMatch = userInput.match(/(?:table|dynamodb)\s+[`"']?(\w[\w-]+)/i);
  if (tableMatch) ctx.params.table = tableMatch[1];

  // SQL query
  const sqlMatch = userInput.match(/(?:SELECT|INSERT|UPDATE|DELETE)\s+.+/i);
  if (sqlMatch) ctx.params.sql = sqlMatch[0];

  // S3 bucket
  const bucketMatch = userInput.match(/(?:bucket|s3)\s+[`"']?(\w[\w.-]+)/i);
  if (bucketMatch) ctx.params.bucket = bucketMatch[1];

  // Error pattern to search for
  const errorMatch = userInput.match(/(?:search|look|find|check)\s+(?:for\s+)?["']?([^"']+?)["']?\s+(?:in|from|across)/i);
  if (errorMatch) ctx.params.filterPattern = errorMatch[1].trim();
  if (!ctx.params.filterPattern && /error/i.test(input)) ctx.params.filterPattern = "ERROR";

  // Metric name
  const metricMatch = userInput.match(/metric\s+[`"']?(\w+)/i);
  if (metricMatch) ctx.params.metricName = metricMatch[1];

  // Time range
  if (/last\s+(hour|60\s*min)/i.test(input)) ctx.params.startMinsAgo = 60;
  else if (/last\s+(24|day)/i.test(input)) ctx.params.startMinsAgo = 1440;
  else if (/last\s+(week|7\s*day)/i.test(input)) ctx.params.startMinsAgo = 10080;
  else if (/last\s+(\d+)\s*min/i.test(input)) ctx.params.startMinsAgo = parseInt(input.match(/last\s+(\d+)\s*min/i)[1]);

  // Alarm state filter
  if (/alarm|firing|active/i.test(input) && !/all/i.test(input)) ctx.params.stateValue = "ALARM";

  return ctx;
}

/**
 * Classify tools into discovery (can run without params) vs detail (need params).
 */
function classifyTools(tools) {
  const discoveryPatterns = [
    "list_log_groups", "list_metrics", "describe_alarms",
    "list", "schema"
  ];
  const midTierPatterns = [
    "search_logs", "get_log_streams", "scan", "query"
  ];
  const detailPatterns = [
    "get_log_events", "get_metric_data", "get_item", "get_file"
  ];

  const discoveryTools = [];
  const detailTools = [];

  for (const tool of tools) {
    const action = tool.split("__").pop();
    if (detailPatterns.some(p => action.includes(p))) {
      detailTools.push(tool);
    } else if (midTierPatterns.some(p => action.includes(p))) {
      // Mid-tier: run after discovery but before deep detail
      detailTools.unshift(tool); // Add to front of detail queue
    } else {
      discoveryTools.push(tool);
    }
  }

  return { discoveryTools, detailTools };
}

/**
 * Build smart params for a tool based on parsed context and prior results.
 */
function buildSmartParams(toolName, context, priorResults) {
  const action = toolName.split("__").pop();
  const p = context.params;

  switch (action) {
    case "list_log_groups":
      return p.logGroupPrefix ? { prefix: p.logGroupPrefix } : {};

    case "search_logs": {
      const logGroup = p.logGroupName || context.discoveredLogGroup;
      if (!logGroup) return { _skip: true, _skipReason: "No log group specified or discovered. Provide a log group name like '/aws/lambda/my-function'." };
      return { logGroupName: logGroup, filterPattern: p.filterPattern || "ERROR", startMinsAgo: p.startMinsAgo || 60 };
    }

    case "get_log_streams": {
      const logGroup = p.logGroupName || context.discoveredLogGroup;
      if (!logGroup) return { _skip: true, _skipReason: "No log group available." };
      return { logGroupName: logGroup, limit: 10 };
    }

    case "get_log_events": {
      const logGroup = p.logGroupName || context.discoveredLogGroup;
      const stream = context.discoveredLogStream;
      if (!logGroup || !stream) return { _skip: true, _skipReason: "Need both a log group and log stream. Provide a specific log group name." };
      return { logGroupName: logGroup, logStreamName: stream, startMinsAgo: p.startMinsAgo || 60 };
    }

    case "list_metrics":
      return p.namespace ? { namespace: p.namespace } : {};

    case "get_metric_data": {
      const ns = p.namespace || context.discoveredNamespace;
      const metric = p.metricName || context.discoveredMetric;
      if (!ns || !metric) return { _skip: true, _skipReason: "Need namespace and metric name. E.g., namespace='AWS/Lambda', metricName='Errors'." };
      return { namespace: ns, metricName: metric, startMinsAgo: p.startMinsAgo || 60 };
    }

    case "describe_alarms":
      return p.stateValue ? { stateValue: p.stateValue } : {};

    case "query": {
      if (p.sql) return { sql: p.sql };
      // If no SQL provided, run a useful default
      return { sql: "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20" };
    }

    case "schema":
      return p.table ? { table: p.table } : {};

    case "scan": {
      if (!p.table) return { _skip: true, _skipReason: "Need a DynamoDB table name. Provide it like: 'scan table my-table-name'." };
      return { table: p.table, limit: 10 };
    }

    case "get_item": {
      if (!p.table) return { _skip: true, _skipReason: "Need table name and key for DynamoDB get_item." };
      return { table: p.table, key: p.key || {} };
    }

    case "get_file": {
      if (!p.bucket || !p.key) return { _skip: true, _skipReason: "Need bucket and key for S3 get_file." };
      return { bucket: p.bucket, key: p.key };
    }

    default:
      return p;
  }
}

/**
 * Enrich context from Phase 1 discovery results.
 * Extracts useful data like the first error-containing log group,
 * active namespaces from metrics, etc.
 */
function enrichContextFromResults(context, results) {
  for (const r of results) {
    if (!r.success) continue;
    const action = (r.tool || "").split("__").pop();
    const text = extractResultText(r.result);
    if (!text) continue;

    try {
      if (action === "list_log_groups" && !context.params.logGroupName) {
        const groups = JSON.parse(text);
        if (Array.isArray(groups) && groups.length > 0) {
          // Pick the most relevant log group: prefer ones with stored data, 
          // matching user keywords, or ECS/Lambda groups
          const input = context.raw.toLowerCase();
          const keywords = input.match(/\b(lambda|ecs|eks|api|gateway|firehose)\b/gi) || [];
          
          let bestGroup = null;
          for (const g of groups) {
            const name = g.name || "";
            if (keywords.some(k => name.toLowerCase().includes(k.toLowerCase()))) {
              bestGroup = name;
              break;
            }
          }
          // Fallback: pick first group with stored bytes > 0
          if (!bestGroup) {
            bestGroup = groups.find(g => g.storedBytes > 0)?.name || groups[0]?.name;
          }
          if (bestGroup) context.discoveredLogGroup = bestGroup;
        }
      }

      if (action === "list_metrics" && !context.params.namespace) {
        const data = JSON.parse(text);
        const metrics = data.metrics || data;
        if (Array.isArray(metrics) && metrics.length > 0) {
          // Extract unique namespaces
          const namespaces = [...new Set(metrics.map(m => m.namespace).filter(Boolean))];
          if (namespaces.length > 0) {
            context.discoveredNamespace = namespaces[0];
            // Try to find an error-related metric
            const errorMetric = metrics.find(m => /error|fault|fail/i.test(m.metricName));
            if (errorMetric) {
              context.discoveredNamespace = errorMetric.namespace;
              context.discoveredMetric = errorMetric.metricName;
            }
          }
        }
      }

      if (action === "get_log_streams" && !context.discoveredLogStream) {
        const streams = JSON.parse(text);
        const list = Array.isArray(streams) ? streams : (streams.streams || []);
        if (list.length > 0) {
          context.discoveredLogStream = list[0].logStreamName || list[0].name;
        }
      }
    } catch (_) { /* JSON parse failures are fine, not all results are JSON */ }
  }
}

/**
 * Extract text content from a tool result (handles MCP content format).
 */
function extractResultText(result) {
  if (!result) return null;
  if (typeof result === "string") return result;
  if (result.content && Array.isArray(result.content)) {
    const textParts = result.content.filter(c => c.type === "text").map(c => c.text);
    return textParts.join("\n");
  }
  if (result.text) return result.text;
  return JSON.stringify(result);
}

// ─── Built Agent MCP Tools ───────────────────────────────────────────────────

/**
 * Each tool, when called, executes that agent with the provided input.
 * This makes every built agent callable from Copilot/Claude/Cursor via MCP.
 */
export function collectBuiltAgentTools() {
  const agents = Object.values(loadAgents() || {});
  return agents
    .filter(a => a.status === "active")
    .map(a => {
      const safeName = `built_agent__${a.name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase()}`;
      return {
        name: safeName,
        description: `[Built Agent] ${a.description || a.name}. Tools: ${a.tools.join(", ")}`,
        schema: {
          input: z.string().describe(`The task or query for the "${a.name}" agent`),
        },
        _builtAgentId: a.id,
        _agentName: a.name,
        _systemPrompt: a.systemPrompt || "",
        _tools: a.tools || [],
      };
    });
}

/**
 * Returns MCP prompt definitions for each built agent.
 * These prompts deliver the agent's systemPrompt + tool list to the LLM,
 * enabling real agent-style planning instead of blind tool execution.
 */
export function collectBuiltAgentPrompts() {
  const agents = Object.values(loadAgents() || {});
  return agents
    .filter(a => a.status === "active" && a.systemPrompt)
    .map(a => {
      const safeName = `built_agent__${a.name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase()}`;
      return {
        name: safeName,
        description: a.description || a.name,
        _agentName: a.name,
        _systemPrompt: a.systemPrompt,
        _tools: a.tools || [],
      };
    });
}
