/**
 * Web UI Server — Configuration Dashboard
 * 
 * Provides a browser-based interface for:
 * - Browsing available services
 * - Configuring connections
 * - Testing connectivity
 * - Generating MCP configs for AI agents
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  getCatalog,
  getCatalogByCategory,
  getServiceDefinition,
  getAllConnections,
  getConnection,
  saveConnection,
  deleteConnection,
  generateConnectionId,
} from "../core/registry.js";
import {
  initializeAll,
  testConnection,
  loadAdapter,
  unloadAdapter,
  collectAllTools,
} from "../core/adapter-manager.js";
import { getAllAgentConfigs } from "../mcp/config-generator.js";
import {
  getAllAgents,
  getAgent,
  registerAgent,
  updateAgent,
  deleteAgent as deleteAgentEntry,
} from "../core/agent-store.js";
import {
  getAllRegistryAgents,
  getRegistryAgent,
  onboardAgent,
  updateRegistryAgent,
  removeRegistryAgent,
  checkAgentHealth,
  executeRegistryTool,
  collectRegistryTools,
} from "../core/agent-registry.js";
import {
  createAgent as createBuiltAgent,
  updateAgent as updateBuiltAgent,
  deleteAgent as deleteBuiltAgent,
  getAgent as getBuiltAgent,
  listAgents as listBuiltAgents,
  executeAgent,
  handleWebhook,
  getAvailableTools,
  exportAgentAsMCPTool,
  syncRegistryOnStartup,
} from "../core/agent-builder.js";
import {
  getAllPrompts,
  getPrompt,
  getCategories as getPromptCategories,
  createCustomPrompt,
  deleteCustomPrompt,
} from "../core/prompt-registry.js";
import { getDefaultAgents, getDefaultAgent } from "../core/default-agents.js";
import { checkSkillGap, getDefaultAgentsByRole } from "../core/default-agents.js";
import { handleAgentMcp, listAgentMcpEndpoints } from "../mcp/agent-mcp.js";
import { forceRefresh as forceAwsRefresh } from "../core/aws-credentials.js";
import {
  getStats as getGovernanceStats,
  queryAuditLogs,
  exportAuditCSV,
  cleanupLogs,
  getPolicies,
  addPolicy,
  updatePolicy,
  deletePolicy as deleteGovernancePolicy,
  resetPolicies,
  getBucketStats,
  setEnabled as setGovernanceEnabled,
  isEnabled as isGovernanceEnabled,
  getAlertConfig,
  updateAlertConfig,
  updateAlertRule,
  getRecentAlerts,
  clearRecentAlerts,
  getApprovals,
  approveRequest,
  rejectRequest,
  getPendingCount,
  scanPromptInjection,
} from "../governance/index.js";
import { generateReport, getBlockedActionsReport } from "../governance/security-report.js";
import { logActivity, queryActivity, getActivityStats, getDangerousActions } from "../governance/system-monitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── API Routes ──────────────────────────────────────────────────────────────

// Get service catalog
app.get("/api/catalog", (req, res) => {
  res.json(getCatalogByCategory());
});

// Get single service definition
app.get("/api/catalog/:serviceId", (req, res) => {
  const svc = getServiceDefinition(req.params.serviceId);
  if (!svc) return res.status(404).json({ error: "Service not found" });
  res.json(svc);
});

// List all connections
app.get("/api/connections", (req, res) => {
  const conns = getAllConnections();
  // Strip passwords from response
  const safe = Object.values(conns).map(c => ({
    ...c,
    config: Object.fromEntries(
      Object.entries(c.config).map(([k, v]) => {
        const svc = getServiceDefinition(c.serviceId);
        const field = svc?.fields?.find(f => f.key === k);
        if (field?.type === "password" && v) return [k, "••••••••"];
        return [k, v];
      })
    ),
  }));
  res.json(safe);
});

// Get single connection (?raw=1 for edit form, otherwise mask passwords)
app.get("/api/connections/:id", (req, res) => {
  const conn = getConnection(req.params.id);
  if (!conn) return res.status(404).json({ error: "Connection not found" });
  if (req.query.raw === "1") return res.json(conn);
  // Mask passwords
  const svc = getServiceDefinition(conn.serviceId);
  const safeConfig = Object.fromEntries(
    Object.entries(conn.config).map(([k, v]) => {
      const field = svc?.fields?.find(f => f.key === k);
      if (field?.type === "password" && v) return [k, "••••••••"];
      return [k, v];
    })
  );
  res.json({ ...conn, config: safeConfig });
});

// Create/update connection
app.post("/api/connections", async (req, res) => {
  const { serviceId, name, config, mode } = req.body;
  const svc = getServiceDefinition(serviceId);
  if (!svc) return res.status(400).json({ error: "Invalid service ID" });

  const missing = svc.fields.filter(f => f.required && !config[f.key]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.map(f => f.key).join(", ")}` });
  }

  const connId = generateConnectionId(serviceId);
  const conn = saveConnection(connId, serviceId, config, name, mode);
  res.json(conn);
});

// Update existing connection
app.put("/api/connections/:id", async (req, res) => {
  const { name, config, mode } = req.body;
  const existing = getConnection(req.params.id);
  if (!existing) return res.status(404).json({ error: "Connection not found" });

  const svc = getServiceDefinition(existing.serviceId);
  if (!svc) return res.status(400).json({ error: "Unknown service type" });

  // Merge: keep old values for password fields that come back as masked
  const mergedConfig = { ...existing.config };
  for (const field of svc.fields) {
    const incoming = config[field.key];
    if (field.type === "password" && (!incoming || incoming === "••••••••")) {
      // keep existing password
    } else if (incoming !== undefined) {
      mergedConfig[field.key] = incoming;
    }
  }

  // Unload old adapter, save, reload
  try { await unloadAdapter(req.params.id); } catch (_) {}
  const conn = saveConnection(req.params.id, existing.serviceId, mergedConfig, name || existing.name, mode);
  try { await loadAdapter(req.params.id); } catch (_) {}
  res.json(conn);
});

// Test connection
app.post("/api/connections/:id/test", async (req, res) => {
  try {
    const result = await testConnection(req.params.id);
    res.json(result);
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

// Refresh AWS credentials for a connection (and all connections sharing the same profile)
app.post("/api/connections/:id/refresh", async (req, res) => {
  try {
    const conn = getConnection(req.params.id);
    if (!conn) return res.status(404).json({ ok: false, message: "Connection not found" });
    const sid = conn.serviceId || "";
    if (!sid.startsWith("aws_") && !["cloudwatch","s3","dynamodb","sqs","lambda","ec2","rds","sns","ecs","route53","iam","eks"].includes(sid)) {
      return res.status(400).json({ ok: false, message: "Not an AWS connection" });
    }
    const profile = conn.config?.profile || "default";
    forceAwsRefresh(profile);

    // Reload ALL AWS connections sharing this profile so all SDK clients get fresh creds
    const allConns = Object.values(getAllConnections());
    const awsConns = allConns.filter(c => {
      const s = c.serviceId || "";
      const isAws = s.startsWith("aws_") || ["cloudwatch","s3","dynamodb","sqs","lambda","ec2","rds","sns","ecs","route53","iam","eks"].includes(s);
      return isAws && (c.config?.profile || "default") === profile;
    });
    let reloaded = 0;
    for (const c of awsConns) {
      try { await unloadAdapter(c.id); } catch (_) {}
      try { await loadAdapter(c.id); reloaded++; } catch (_) {}
    }

    res.json({ ok: true, message: `AWS credentials refreshed for profile [${profile}] — ${reloaded} connection(s) reloaded` });
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

// Delete connection
app.delete("/api/connections/:id", async (req, res) => {
  try {
    await unloadAdapter(req.params.id);
  } catch (_) {}
  deleteConnection(req.params.id);
  res.json({ ok: true });
});

// Get active tools
app.get("/api/tools", async (req, res) => {
  try {
    await initializeAll();
  } catch (e) {
    console.error("initializeAll error:", e.message);
  }
  const tools = collectAllTools();
  res.json(tools.map(t => ({
    name: t.name,
    description: t.description,
    service: t._serviceId,
    connection: t._connectionName,
  })));
});

// Get AI agent configs
app.get("/api/agent-configs", (req, res) => {
  res.json(getAllAgentConfigs());
});

// Dashboard stats
app.get("/api/stats", async (req, res) => {
  const conns = getAllConnections();
  const connList = Object.values(conns);
  let toolCount = 0;
  try {
    await initializeAll();
    toolCount = collectAllTools().length;
  } catch (e) {
    console.error("initializeAll error:", e.message);
  }
  const registryAgents = getAllRegistryAgents();
  const registryTools = collectRegistryTools();
  res.json({
    totalServices: Object.keys(getCatalog()).length,
    totalConnections: connList.length,
    activeConnections: connList.filter(c => c.status === "connected").length,
    errorConnections: connList.filter(c => c.status === "error").length,
    totalTools: toolCount + registryTools.length,
    registryAgents: registryAgents.length,
    registryHealthy: registryAgents.filter(a => a.status === "healthy").length,
    registryTools: registryTools.length,
  });
});

// ─── Connected Agents (Phase 2) ─────────────────────────────────────────────

// List all registered agents
app.get("/api/agents", (req, res) => {
  res.json(getAllAgents());
});

// Get single agent
app.get("/api/agents/:id", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json(agent);
});

// Register new agent
app.post("/api/agents", (req, res) => {
  const { name, description, type, endpoint, protocol, capabilities } = req.body;
  if (!name) return res.status(400).json({ error: "Agent name is required" });
  const agent = registerAgent({ name, description, type, endpoint, protocol, capabilities });
  res.json(agent);
});

// Update agent
app.put("/api/agents/:id", (req, res) => {
  const agent = updateAgent(req.params.id, req.body);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json(agent);
});

// Delete agent
app.delete("/api/agents/:id", (req, res) => {
  const deleted = deleteAgentEntry(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Agent not found" });
  res.json({ ok: true });
});

// ─── Agent Registry (Developer Onboarding) ──────────────────────────────────

// List all onboarded agents
app.get("/api/registry/agents", (req, res) => {
  res.json(getAllRegistryAgents());
});

// Get single registry agent
app.get("/api/registry/agents/:id", (req, res) => {
  const agent = getRegistryAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json(agent);
});

// Onboard a new agent (developer submits manifest)
app.post("/api/registry/agents", async (req, res) => {
  const result = onboardAgent(req.body);
  if (!result.ok) return res.status(400).json({ error: "Invalid manifest", details: result.errors });

  // Auto health-check on onboard
  const health = await checkAgentHealth(result.agent.id);
  const agent = getRegistryAgent(result.agent.id);
  res.json({ ...agent, healthResult: health });
});

// Update a registry agent
app.put("/api/registry/agents/:id", (req, res) => {
  const agent = updateRegistryAgent(req.params.id, req.body);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json(agent);
});

// Remove a registry agent
app.delete("/api/registry/agents/:id", (req, res) => {
  const deleted = removeRegistryAgent(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Agent not found" });
  res.json({ ok: true });
});

// Health check a registry agent
app.post("/api/registry/agents/:id/health", async (req, res) => {
  const result = await checkAgentHealth(req.params.id);
  res.json(result);
});

// Execute a tool on a registry agent (proxy)
app.post("/api/registry/agents/:id/tools/:toolName", async (req, res) => {
  const result = await executeRegistryTool(req.params.id, req.params.toolName, req.body);
  if (!result.ok) return res.status(502).json(result);
  res.json(result);
});

// Get all tools from registry agents (for MCP/UI)
app.get("/api/registry/tools", (req, res) => {
  res.json(collectRegistryTools());
});

// Stats: include registry agents
app.get("/api/registry/stats", (req, res) => {
  const agents = getAllRegistryAgents();
  const tools = collectRegistryTools();
  res.json({
    totalAgents: agents.length,
    healthyAgents: agents.filter(a => a.status === "healthy").length,
    totalTools: tools.length,
  });
});

// ─── Agent Builder API ───────────────────────────────────────────────────────

app.get("/api/builder/tools", (req, res) => {
  try { res.json(getAvailableTools() || []); }
  catch (err) { res.json([]); }
});

app.get("/api/builder/agents", (req, res) => {
  try { res.json(listBuiltAgents() || []); }
  catch (err) { res.json([]); }
});

app.get("/api/builder/agents/:id", (req, res) => {
  const agent = getBuiltAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json(agent);
});

app.post("/api/builder/agents", (req, res) => {
  const result = createBuiltAgent(req.body);
  if (!result.success) return res.status(400).json({ error: "Validation failed", details: result.errors });
  res.status(201).json(result.agent);
});

app.put("/api/builder/agents/:id", (req, res) => {
  const result = updateBuiltAgent(req.params.id, req.body);
  if (!result.success) return res.status(400).json({ error: result.errors[0] });
  res.json(result.agent);
});

app.delete("/api/builder/agents/:id", (req, res) => {
  const result = deleteBuiltAgent(req.params.id);
  if (!result.success) return res.status(404).json({ error: result.errors[0] });
  res.json({ success: true });
});

app.post("/api/builder/agents/:id/execute", async (req, res) => {
  try {
    const result = await executeAgent(req.params.id, req.body.input || req.body);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/builder/agents/:id/export-mcp", (req, res) => {
  const tool = exportAgentAsMCPTool(req.params.id);
  if (!tool) return res.status(404).json({ error: "Agent not found" });
  res.json(tool);
});

app.post("/api/builder/webhook/:id", async (req, res) => {
  try {
    const result = await handleWebhook(req.params.id, req.body);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Prompt Registry API ─────────────────────────────────────────────────────

app.get("/api/prompts", (req, res) => {
  res.json(getAllPrompts());
});

app.get("/api/prompts/categories", (req, res) => {
  res.json(getPromptCategories());
});

app.get("/api/prompts/:id", (req, res) => {
  const prompt = getPrompt(req.params.id);
  if (!prompt) return res.status(404).json({ error: "Prompt not found" });
  res.json(prompt);
});

app.post("/api/prompts", (req, res) => {
  const result = createCustomPrompt(req.body);
  if (!result.success) return res.status(400).json({ error: "Validation failed", details: result.errors });
  res.status(201).json(result.prompt);
});

app.delete("/api/prompts/:id", (req, res) => {
  const result = deleteCustomPrompt(req.params.id);
  if (!result.success) return res.status(400).json({ error: result.errors[0] });
  res.json({ success: true });
});

// ─── Default Agent Templates API ─────────────────────────────────────────────

app.get("/api/builder/templates", (req, res) => {
  res.json(getDefaultAgents());
});

app.post("/api/builder/templates/:id/install", (req, res) => {
  const template = getDefaultAgent(req.params.id);
  if (!template) return res.status(404).json({ error: "Template not found" });
  const { id: _id, category: _cat, ...agentData } = template;

  // Resolve generic tool names (e.g. "postgresql__query") to actual connection-specific
  // tool names (e.g. "postgresql_mnz1wzbl__query") based on user's active connections.
  const allTools = collectAllTools();
  const resolveToolName = (generic) => {
    // If it already matches an actual tool, use it directly
    if (allTools.find(t => t.name === generic)) return generic;
    // Otherwise try to match: generic "serviceId__action" → actual "{serviceId}_{connId}__{action}"
    const dblIdx = generic.indexOf("__");
    if (dblIdx === -1) return generic;
    const svcPart = generic.substring(0, dblIdx);     // e.g. "postgresql"
    const actionPart = generic.substring(dblIdx + 2);  // e.g. "query"
    // Try exact serviceId match first, then suffix match (e.g. "cloudwatch" matches "aws_cloudwatch")
    const match = allTools.find(t => t._serviceId === svcPart && t.name.endsWith("__" + actionPart))
      || allTools.find(t => t._serviceId.endsWith(svcPart) && t.name.endsWith("__" + actionPart))
      || allTools.find(t => t.name.endsWith("__" + actionPart) && t._serviceId.includes(svcPart));
    return match ? match.name : generic;
  };

  if (agentData.tools) {
    agentData.tools = agentData.tools.map(resolveToolName);
  }
  if (agentData.steps) {
    agentData.steps = agentData.steps.map(s => ({ ...s, tool: resolveToolName(s.tool) }));
  }

  const result = createBuiltAgent(agentData);
  if (!result.success) return res.status(400).json({ error: "Install failed", details: result.errors });
  res.status(201).json(result.agent);
});

// Filter templates by role (engineer, devops, pm, manager, sre, dba, data, security, lead)
app.get("/api/builder/templates/role/:role", (req, res) => {
  res.json(getDefaultAgentsByRole(req.params.role));
});

// Skill gap check — what connections does this agent need that you don't have?
app.get("/api/builder/templates/:id/skill-gap", (req, res) => {
  const connections = getAllConnections();
  const activeConns = Object.values(connections).filter(c => c.status === "connected" || c.status === "configured");
  const result = checkSkillGap(req.params.id, activeConns);
  if (!result) return res.status(404).json({ error: "Template not found" });
  res.json(result);
});

// ─── Per-Agent MCP Endpoints ─────────────────────────────────────────────────

// List all agent MCP endpoints
app.get("/mcp/agents", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.json(listAgentMcpEndpoints(baseUrl));
});

// Individual agent MCP server (Streamable HTTP)
app.all("/mcp/agents/:agentId", (req, res) => {
  // Skip /config and /share sub-routes
  if (req.params.agentId === "config" || req.params.agentId === "share") return res.status(404).json({ error: "Not found" });
  handleAgentMcp(req, res);
});

// Per-agent shareable MCP config — generates ready-to-paste IDE configs
app.get("/mcp/agents/:agentId/config", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const agents = listAgentMcpEndpoints(baseUrl);
  const agent = agents.find(a => a.id === req.params.agentId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const mcpUrl = agent.mcpEndpoint;
  const tag = agent.tag;

  res.json({
    agent: { id: agent.id, name: agent.name, tag, tools: agent.tools.length, description: agent.description },
    mcpEndpoint: mcpUrl,
    configs: {
      vscode: {
        description: "Add to .vscode/mcp.json",
        config: {
          servers: {
            [`snayu-${tag}`]: { type: "http", url: mcpUrl }
          }
        }
      },
      cursor: {
        description: "Add to .cursor/mcp.json",
        config: {
          mcpServers: {
            [`snayu-${tag}`]: { url: mcpUrl }
          }
        }
      },
      claude: {
        description: "Add to claude_desktop_config.json",
        config: {
          mcpServers: {
            [`snayu-${tag}`]: { type: "streamable-http", url: mcpUrl }
          }
        }
      },
      windsurf: {
        description: "Add to .windsurf/mcp.json",
        config: {
          mcpServers: {
            [`snayu-${tag}`]: { serverUrl: mcpUrl }
          }
        }
      }
    }
  });
});

// ─── Governance API ──────────────────────────────────────────────────────────

app.get("/api/governance/stats", (req, res) => {
  res.json({ enabled: isGovernanceEnabled(), stats: getGovernanceStats(), rateLimits: getBucketStats() });
});

app.post("/api/governance/toggle", (req, res) => {
  setGovernanceEnabled(!!req.body.enabled);
  res.json({ enabled: isGovernanceEnabled() });
});

app.get("/api/governance/logs", (req, res) => {
  const { startDate, endDate, toolName, agentId, connectionId, blocked, search, limit, offset } = req.query;
  const logs = queryAuditLogs({ startDate, endDate, toolName, agentId, connectionId, blocked: blocked === "true" ? true : undefined, search, limit: Number(limit) || 100, offset: Number(offset) || 0 });
  res.json(logs);
});

app.get("/api/governance/logs/export", (req, res) => {
  const { startDate, endDate } = req.query;
  const csv = exportAuditCSV({ startDate, endDate });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=audit-log.csv");
  res.send(csv);
});

app.post("/api/governance/logs/cleanup", (req, res) => {
  const removed = cleanupLogs(Number(req.body.retentionDays) || 90);
  res.json({ removed });
});

app.get("/api/governance/policies", (req, res) => {
  res.json(getPolicies());
});

app.post("/api/governance/policies", (req, res) => {
  res.json(addPolicy(req.body));
});

app.put("/api/governance/policies/:id", (req, res) => {
  const result = updatePolicy(req.params.id, req.body);
  result ? res.json(result) : res.status(404).json({ error: "Policy not found" });
});

app.delete("/api/governance/policies/:id", (req, res) => {
  deleteGovernancePolicy(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: "Policy not found" });
});

app.post("/api/governance/policies/reset", (req, res) => {
  res.json(resetPolicies());
});

// Alerts
app.get("/api/governance/alerts/config", (req, res) => {
  res.json(getAlertConfig());
});

app.put("/api/governance/alerts/config", (req, res) => {
  res.json(updateAlertConfig(req.body));
});

app.put("/api/governance/alerts/rules/:event", (req, res) => {
  const result = updateAlertRule(req.params.event, req.body);
  result ? res.json(result) : res.status(404).json({ error: "Rule not found" });
});

app.get("/api/governance/alerts/recent", (req, res) => {
  res.json(getRecentAlerts(Number(req.query.limit) || 50));
});

app.post("/api/governance/alerts/clear", (req, res) => {
  clearRecentAlerts();
  res.json({ ok: true });
});

// Approvals
app.get("/api/governance/approvals", (req, res) => {
  res.json(getApprovals({ status: req.query.status, limit: Number(req.query.limit) || 50 }));
});

app.get("/api/governance/approvals/pending-count", (req, res) => {
  res.json({ count: getPendingCount() });
});

app.post("/api/governance/approvals/:id/approve", (req, res) => {
  const result = approveRequest(req.params.id, req.body);
  result ? res.json(result) : res.status(404).json({ error: "Not found" });
});

app.post("/api/governance/approvals/:id/reject", (req, res) => {
  const result = rejectRequest(req.params.id, req.body);
  result ? res.json(result) : res.status(404).json({ error: "Not found" });
});

// Prompt Guard test
app.post("/api/governance/prompt-guard/test", (req, res) => {
  const text = req.body.text || req.body.sql || (typeof req.body === "string" ? req.body : JSON.stringify(req.body));
  res.json(scanPromptInjection(text));
});

// Security Reports
app.get("/api/governance/report", (req, res) => {
  const { startDate, endDate, format } = req.query;
  const report = generateReport({ startDate, endDate, format: format || "json" });
  if (format === "markdown") {
    res.setHeader("Content-Type", "text/markdown");
    res.send(report);
  } else {
    res.json(report);
  }
});

app.get("/api/governance/report/download", (req, res) => {
  const { startDate, endDate } = req.query;
  const md = generateReport({ startDate, endDate, format: "markdown" });
  res.setHeader("Content-Type", "text/markdown");
  res.setHeader("Content-Disposition", "attachment; filename=snayu-security-report.md");
  res.send(md);
});

app.get("/api/governance/blocked", (req, res) => {
  res.json(getBlockedActionsReport(req.query));
});

// System Activity Monitor
app.get("/api/governance/activity", (req, res) => {
  res.json(queryActivity(req.query));
});

app.get("/api/governance/activity/stats", (req, res) => {
  res.json(getActivityStats());
});

app.get("/api/governance/activity/dangerous", (req, res) => {
  res.json(getDangerousActions(Number(req.query.limit) || 50));
});

app.post("/api/governance/activity/log", (req, res) => {
  const entry = logActivity(req.body);
  res.json(entry);
});

// ─── Serve UI (catch-all — must be LAST) ─────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3456;

export function startWebServer() {
  return new Promise((resolve) => {
    const httpServer = app.listen(PORT, () => {
      console.log(`\n⚡ Snayu Dashboard: http://localhost:${PORT}\n`);
      resolve(httpServer);
    });
  });
}

// Run directly
if (process.argv[1] && process.argv[1].includes("web/server")) {
  await initializeAll();
  syncRegistryOnStartup();
  await startWebServer();
}
