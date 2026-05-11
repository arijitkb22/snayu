/**
 * Adapter Manager — Loads and manages adapter instances for active connections.
 * 
 * This is the bridge between the registry (what is configured) and the
 * running adapters (what is live). The MCP server uses this to discover
 * and invoke tools.
 */

import { getActiveConnections, getConnection, getAllConnections, updateConnectionStatus } from "./registry.js";

// ─── Adapter module map ──────────────────────────────────────────────────────
const ADAPTER_MODULES = {
  // Databases
  postgresql:     () => import("../adapters/postgresql.js"),
  mysql:          () => import("../adapters/mysql.js"),
  mongodb:        () => import("../adapters/mongodb.js"),
  dynamodb:       () => import("../adapters/dynamodb.js"),
  // Cloud
  aws_s3:         () => import("../adapters/s3.js"),
  aws_cloudwatch: () => import("../adapters/cloudwatch.js"),
  // Search
  elasticsearch:  () => import("../adapters/elasticsearch.js"),
  // DevOps
  github:         () => import("../adapters/github.js"),
  gitlab:         () => import("../adapters/gitlab.js"),
  jira:           () => import("../adapters/jira.js"),
  confluence:     () => import("../adapters/confluence.js"),
  // Communication
  slack:          () => import("../adapters/slack.js"),
  teams:          () => import("../adapters/teams.js"),
  // Monitoring
  datadog:        () => import("../adapters/datadog.js"),
  pagerduty:      () => import("../adapters/pagerduty.js"),
  // Custom / Generic
  rest_api:       () => import("../adapters/rest-api.js"),
  webhook:        () => import("../adapters/webhook.js"),
  // Cache / KV
  redis:          () => import("../adapters/redis.js"),
  // Data Warehouse
  snowflake:      () => import("../adapters/snowflake.js"),
  // Email
  sendgrid:       () => import("../adapters/sendgrid.js"),
  // AI / LLM
  openai:         () => import("../adapters/openai.js"),
  // Knowledge Base
  notion:         () => import("../adapters/notion.js"),
  // Containers
  kubernetes:     () => import("../adapters/kubernetes.js"),
  // Message Queues
  aws_sqs:        () => import("../adapters/sqs.js"),
  // Security / SIEM
  splunk:         () => import("../adapters/splunk.js"),
};

// ─── Live adapter instances ──────────────────────────────────────────────────
const adapters = new Map(); // connectionId → adapter instance

/**
 * Load an adapter for a specific connection.
 */
export async function loadAdapter(connectionId) {
  const conn = getConnection(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);

  const loaderFn = ADAPTER_MODULES[conn.serviceId];
  if (!loaderFn) {
    console.error(`No adapter module for service: ${conn.serviceId}`);
    return null;
  }

  try {
    const mod = await loaderFn();
    const AdapterClass = mod.default;
    const adapter = new AdapterClass(conn);
    adapters.set(connectionId, adapter);
    return adapter;
  } catch (e) {
    console.error(`Failed to load adapter for ${conn.serviceId}: ${e.message}`);
    return null;
  }
}

/**
 * Initialize all active connections — called at MCP server startup.
 */
export async function initializeAll() {
  const connections = getAllConnections();
  for (const conn of Object.values(connections)) {
    if (conn.status === "connected" || conn.status === "configured") {
      await loadAdapter(conn.id);
    }
  }
  console.error(`[adapter-manager] Loaded ${adapters.size} adapter(s)`);
}

/**
 * Get all currently active adapters.
 */
export function getActiveAdapters() {
  return adapters;
}

/**
 * Get adapter for a specific connection.
 */
export function getAdapter(connectionId) {
  return adapters.get(connectionId) || null;
}

/**
 * Collect all MCP tools from all active adapters.
 * Tools are namespaced with the connection ID to avoid conflicts.
 */
export function collectAllTools() {
  const allTools = [];
  for (const [connId, adapter] of adapters) {
    try {
      const tools = adapter.getTools();
      for (const tool of tools) {
        allTools.push({
          ...tool,
          _connectionId: connId,
          _serviceId: adapter.connection.serviceId,
          _connectionName: adapter.connection.name,
        });
      }
    } catch (e) {
      console.error(`Error collecting tools from ${connId}: ${e.message}`);
    }
  }
  return allTools;
}

/**
 * Execute a tool by its full name, routing to the correct adapter.
 */
export async function executeTool(toolName, params) {
  // Tools are registered with their connection ID prefix
  for (const [connId, adapter] of adapters) {
    const tools = adapter.getTools();
    const match = tools.find(t => t.name === toolName);
    if (match) {
      return adapter.executeTool(toolName, params);
    }
  }
  throw new Error(`Tool not found: ${toolName}`);
}

/**
 * Test a specific connection and update its status.
 */
export async function testConnection(connectionId) {
  let adapter = adapters.get(connectionId);
  if (!adapter) {
    adapter = await loadAdapter(connectionId);
  }
  if (!adapter) {
    updateConnectionStatus(connectionId, "error", "No adapter available for this service type");
    return { ok: false, message: "No adapter available for this service type" };
  }

  try {
    const result = await adapter.testConnection();
    updateConnectionStatus(connectionId, result.ok ? "connected" : "error", result.ok ? null : result.message);
    return result;
  } catch (e) {
    updateConnectionStatus(connectionId, "error", e.message);
    return { ok: false, message: e.message };
  }
}

/**
 * Remove an adapter instance.
 */
export async function unloadAdapter(connectionId) {
  const adapter = adapters.get(connectionId);
  if (adapter) {
    await adapter.disconnect();
    adapters.delete(connectionId);
  }
}

/**
 * Reload all adapters (e.g., after configuration changes).
 */
export async function reloadAll() {
  for (const [id, adapter] of adapters) {
    await adapter.disconnect();
  }
  adapters.clear();
  await initializeAll();
}
