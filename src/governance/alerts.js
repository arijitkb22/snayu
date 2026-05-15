/**
 * Governance Alerts — Fire notifications on policy violations.
 * Integrates with Teams (and extensible to Slack/email).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, "../../data/governance/alerts.json");

let config = null;

function ensureDir() {
  const dir = dirname(CONFIG_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  if (existsSync(CONFIG_FILE)) {
    try { config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")); } catch { config = getDefaults(); }
  } else {
    config = getDefaults();
    save();
  }
}

function save() {
  ensureDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getDefaults() {
  return {
    enabled: true,
    channels: [],  // [{ type: "teams", connectionId: "xxx" }]
    rules: [
      { event: "policy_block", severity: "critical", notify: true, description: "Tool call blocked by policy" },
      { event: "prompt_injection", severity: "critical", notify: true, description: "Prompt injection detected" },
      { event: "secret_detected", severity: "high", notify: true, description: "Secret/PII found in I/O" },
      { event: "rate_limited", severity: "medium", notify: false, description: "Rate limit exceeded" },
      { event: "approval_pending", severity: "medium", notify: true, description: "Tool call awaiting approval" },
      { event: "error", severity: "high", notify: false, description: "Tool execution error" },
    ],
    cooldownMs: 60000,  // Don't re-alert same event within 1 min
    recentAlerts: [],
  };
}

// Cooldown tracking
const lastAlerted = new Map();

/**
 * Fire an alert if the event matches a notify rule.
 * @param {string} event - Event type (policy_block, prompt_injection, etc.)
 * @param {object} detail - { toolName, reason, agentId, connectionId, findings, ... }
 */
export async function fireAlert(event, detail = {}) {
  if (!config) load();
  if (!config.enabled) return;

  const rule = config.rules.find(r => r.event === event && r.notify);
  if (!rule) return;

  // Cooldown check
  const key = `${event}:${detail.toolName || ""}`;
  const now = Date.now();
  if (lastAlerted.has(key) && now - lastAlerted.get(key) < config.cooldownMs) return;
  lastAlerted.set(key, now);

  const alertEntry = {
    event,
    severity: rule.severity,
    timestamp: new Date().toISOString(),
    toolName: detail.toolName,
    reason: detail.reason || rule.description,
    agentId: detail.agentId,
    connectionId: detail.connectionId,
  };

  // Store in recent alerts (keep last 100)
  config.recentAlerts = [alertEntry, ...(config.recentAlerts || [])].slice(0, 100);
  save();

  // Send to channels
  for (const channel of config.channels) {
    try {
      if (channel.type === "teams") {
        await sendTeamsAlert(channel, alertEntry, detail);
      }
    } catch (e) {
      console.error(`[governance] Alert send failed (${channel.type}):`, e.message);
    }
  }
}

async function sendTeamsAlert(channel, alert, detail) {
  // Dynamic import to avoid circular deps
  const { default: AdapterManager } = await import("../core/adapter-manager.js").catch(() => ({}));

  const severityColor = { critical: "FF0000", high: "FF6600", medium: "FFAA00", low: "0076D7" };
  const severityEmoji = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };

  const title = `${severityEmoji[alert.severity] || "⚠️"} Snayu Governance Alert`;
  const text = [
    `**Event:** ${alert.event}`,
    `**Tool:** \`${alert.toolName || "N/A"}\``,
    `**Reason:** ${alert.reason}`,
    alert.agentId ? `**Agent:** ${alert.agentId}` : null,
    alert.connectionId ? `**Connection:** ${alert.connectionId}` : null,
    detail.score !== undefined ? `**Risk Score:** ${detail.score}/100` : null,
    detail.findings?.length ? `**Findings:** ${detail.findings.map(f => f.name).join(", ")}` : null,
  ].filter(Boolean).join("\n\n");

  // If we have a Teams connection ID, try sending through the adapter
  if (channel.connectionId) {
    try {
      const { collectAllTools, executeTool } = await import("../core/adapter-manager.js");
      const tools = await collectAllTools();
      const sendTool = tools.find(t => t.name.includes(channel.connectionId) && t.name.includes("send_card"));
      if (sendTool) {
        // Use raw executeTool to avoid governance loop
        await executeTool(sendTool.name, {
          summary: `Governance Alert: ${alert.event}`,
          title,
          text,
        }, { _skipGovernance: true });
        return;
      }
    } catch (e) {
      console.error("[governance] Teams adapter send failed:", e.message);
    }
  }
}

// ─── Config CRUD ─────────────────────────────────────────────────────────────

export function getAlertConfig() {
  if (!config) load();
  return config;
}

export function updateAlertConfig(updates) {
  if (!config) load();
  if (updates.enabled !== undefined) config.enabled = updates.enabled;
  if (updates.channels) config.channels = updates.channels;
  if (updates.cooldownMs) config.cooldownMs = updates.cooldownMs;
  save();
  return config;
}

export function updateAlertRule(event, updates) {
  if (!config) load();
  const rule = config.rules.find(r => r.event === event);
  if (!rule) return null;
  Object.assign(rule, updates);
  save();
  return rule;
}

export function getRecentAlerts(limit = 50) {
  if (!config) load();
  return (config.recentAlerts || []).slice(0, limit);
}

export function clearRecentAlerts() {
  if (!config) load();
  config.recentAlerts = [];
  save();
}
