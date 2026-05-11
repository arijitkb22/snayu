/**
 * Agent Registry — Developer Agent Onboarding
 * 
 * Developers register their agents with a manifest that declares tools.
 * Once onboarded and healthy, the agent's tools are automatically exposed
 * to ALL Snayu users via the MCP server — zero configuration for end users.
 * 
 * Flow:
 *   Developer registers agent → Snayu validates manifest → health check →
 *   tools are proxied into the universal MCP → all users get new tools instantly.
 * 
 * Persists to data/agent-registry.json.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_FILE = path.resolve(__dirname, "../../data/agent-registry.json");

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadRegistry() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8"));
    }
  } catch (_) {}
  return {};
}

function saveRegistry(registry) {
  const dir = path.dirname(REGISTRY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

// ─── Validation ──────────────────────────────────────────────────────────────

const VALID_PROTOCOLS = ["http", "mcp-stdio", "mcp-sse", "webhook"];

function validateManifest(manifest) {
  const errors = [];
  if (!manifest.name || typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    errors.push("'name' is required");
  }
  if (!manifest.endpoint || typeof manifest.endpoint !== "string") {
    errors.push("'endpoint' is required (HTTP URL or command path)");
  }
  if (!manifest.tools || !Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    errors.push("'tools' must be a non-empty array of tool definitions");
  } else {
    for (let i = 0; i < manifest.tools.length; i++) {
      const t = manifest.tools[i];
      if (!t.name || typeof t.name !== "string") errors.push(`tools[${i}].name is required`);
      if (!t.description || typeof t.description !== "string") errors.push(`tools[${i}].description is required`);
      // Validate tool names don't contain spaces or weird chars
      if (t.name && !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(t.name)) {
        errors.push(`tools[${i}].name '${t.name}' must be alphanumeric (with _ or -, starting with a letter or _)`);
      }
    }
  }
  if (manifest.protocol && !VALID_PROTOCOLS.includes(manifest.protocol)) {
    errors.push(`'protocol' must be one of: ${VALID_PROTOCOLS.join(", ")}`);
  }
  return errors;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function getAllRegistryAgents() {
  return Object.values(loadRegistry());
}

export function getRegistryAgent(id) {
  return loadRegistry()[id] || null;
}

export function onboardAgent(manifest) {
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const registry = loadRegistry();
  const id = `ragent_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

  // Namespace tool names with agent id prefix to avoid collisions
  const namespacedTools = manifest.tools.map(t => ({
    name: t.name,
    namespacedName: `${id}__${t.name}`,
    description: t.description,
    inputSchema: t.inputSchema || {},
  }));

  registry[id] = {
    id,
    name: manifest.name.trim(),
    description: manifest.description || "",
    author: manifest.author || "unknown",
    version: manifest.version || "1.0.0",
    endpoint: manifest.endpoint,
    protocol: manifest.protocol || "http",
    tools: namespacedTools,
    healthEndpoint: manifest.healthEndpoint || null,
    status: "pending",         // pending → healthy → unhealthy → error
    lastHealthCheck: null,
    lastHealthMessage: null,
    onboardedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveRegistry(registry);
  return { ok: true, agent: registry[id] };
}

export function updateRegistryAgent(id, data) {
  const registry = loadRegistry();
  if (!registry[id]) return null;

  // If tools changed, re-namespace
  if (data.tools && Array.isArray(data.tools)) {
    data.tools = data.tools.map(t => ({
      name: t.name,
      namespacedName: `${id}__${t.name}`,
      description: t.description,
      inputSchema: t.inputSchema || {},
    }));
  }

  registry[id] = {
    ...registry[id],
    name: data.name ?? registry[id].name,
    description: data.description ?? registry[id].description,
    author: data.author ?? registry[id].author,
    version: data.version ?? registry[id].version,
    endpoint: data.endpoint ?? registry[id].endpoint,
    protocol: data.protocol ?? registry[id].protocol,
    tools: data.tools ?? registry[id].tools,
    healthEndpoint: data.healthEndpoint ?? registry[id].healthEndpoint,
    updatedAt: new Date().toISOString(),
  };

  saveRegistry(registry);
  return registry[id];
}

export function removeRegistryAgent(id) {
  const registry = loadRegistry();
  if (!registry[id]) return false;
  delete registry[id];
  saveRegistry(registry);
  return true;
}

// ─── Health Check ────────────────────────────────────────────────────────────

export async function checkAgentHealth(id) {
  const registry = loadRegistry();
  const agent = registry[id];
  if (!agent) return { ok: false, message: "Agent not found" };

  const url = agent.healthEndpoint || agent.endpoint;
  if (!url || !url.startsWith("http")) {
    // For non-HTTP protocols, just mark as registered/healthy
    agent.status = "healthy";
    agent.lastHealthCheck = new Date().toISOString();
    agent.lastHealthMessage = "Non-HTTP agent — assumed healthy";
    saveRegistry(registry);
    return { ok: true, message: agent.lastHealthMessage };
  }

  try {
    const healthUrl = agent.healthEndpoint || `${agent.endpoint.replace(/\/+$/, "")}/health`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);

    const res = await fetch(healthUrl, {
      method: "GET",
      signal: ctrl.signal,
      headers: { "User-Agent": "snayu-registry/1.0" },
    });
    clearTimeout(timeout);

    if (res.ok) {
      agent.status = "healthy";
      agent.lastHealthMessage = `HTTP ${res.status} — OK`;
    } else {
      agent.status = "unhealthy";
      agent.lastHealthMessage = `HTTP ${res.status}`;
    }
  } catch (e) {
    agent.status = "unhealthy";
    agent.lastHealthMessage = e.name === "AbortError" ? "Timeout (8s)" : e.message;
  }

  agent.lastHealthCheck = new Date().toISOString();
  saveRegistry(registry);
  return { ok: agent.status === "healthy", message: agent.lastHealthMessage };
}

// ─── Tool Proxy — Execute a tool on a registered agent via HTTP ──────────────

export async function executeRegistryTool(agentId, toolName, params) {
  const agent = getRegistryAgent(agentId);
  if (!agent) return { ok: false, error: "Agent not found" };

  if (agent.protocol !== "http") {
    return {
      ok: false,
      error: `Tool execution for '${agent.protocol}' agents is not yet supported. Only HTTP agents can be proxied.`,
    };
  }

  const endpoint = agent.endpoint.replace(/\/+$/, "");
  const url = `${endpoint}/tools/${toolName}`;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30000);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "snayu-registry/1.0",
        "X-Snayu-Agent-Id": agentId,
      },
      body: JSON.stringify(params || {}),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);

    const body = await res.text();
    let data;
    try { data = JSON.parse(body); } catch (_) { data = body; }

    if (res.ok) {
      return { ok: true, result: data };
    } else {
      return { ok: false, error: `Agent returned HTTP ${res.status}`, details: data };
    }
  } catch (e) {
    return {
      ok: false,
      error: e.name === "AbortError" ? "Agent timeout (30s)" : e.message,
    };
  }
}

// ─── Collect all tools from healthy registry agents ──────────────────────────

export function collectRegistryTools() {
  const agents = getAllRegistryAgents();
  const tools = [];

  for (const agent of agents) {
    // Include tools from healthy or pending agents (give new agents a chance)
    if (agent.status === "error") continue;

    for (const tool of agent.tools) {
      tools.push({
        name: tool.namespacedName,
        description: `[${agent.name}] ${tool.description}`,
        schema: tool.inputSchema || {},
        _agentId: agent.id,
        _agentName: agent.name,
        _originalToolName: tool.name,
      });
    }
  }

  return tools;
}
