/**
 * Agent Store — Manages registered external agents
 * 
 * Stores agent registrations in data/agents.json for persistence.
 * This enables agent-to-agent discovery and communication (Phase 2).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_FILE = path.resolve(__dirname, "../../data/agents.json");

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

export function getAllAgents() {
  return Object.values(loadAgents());
}

export function getAgent(id) {
  const agents = loadAgents();
  return agents[id] || null;
}

export function registerAgent({ name, description, type, endpoint, protocol, capabilities }) {
  const agents = loadAgents();
  const id = `agent_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  agents[id] = {
    id,
    name,
    description: description || "",
    type: type || "custom",
    endpoint: endpoint || "",
    protocol: protocol || "mcp-stdio",
    capabilities: capabilities || [],
    status: "registered",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveAgents(agents);
  return agents[id];
}

export function updateAgent(id, data) {
  const agents = loadAgents();
  if (!agents[id]) return null;
  agents[id] = {
    ...agents[id],
    name: data.name ?? agents[id].name,
    description: data.description ?? agents[id].description,
    type: data.type ?? agents[id].type,
    endpoint: data.endpoint ?? agents[id].endpoint,
    protocol: data.protocol ?? agents[id].protocol,
    capabilities: data.capabilities ?? agents[id].capabilities,
    updatedAt: new Date().toISOString(),
  };
  saveAgents(agents);
  return agents[id];
}

export function deleteAgent(id) {
  const agents = loadAgents();
  if (!agents[id]) return false;
  delete agents[id];
  saveAgents(agents);
  return true;
}
