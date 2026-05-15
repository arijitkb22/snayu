/**
 * Governance Tools Adapter — Exposes governance as MCP tools.
 * 
 * This lets AI agents:
 *   - Query audit logs
 *   - Get blocked actions
 *   - Generate security reports
 *   - Check system activity
 *   - Scan text for secrets/injection
 *   - View/manage policies
 */
import { BaseAdapter } from "../core/adapter-base.js";
import { queryAuditLogs, getStats, exportAuditCSV } from "../governance/audit-log.js";
import { getPolicies } from "../governance/policy-engine.js";
import { getRecentAlerts } from "../governance/alerts.js";
import { getApprovals, getPendingCount } from "../governance/approvals.js";
import { generateReport, getBlockedActionsReport } from "../governance/security-report.js";
import { queryActivity, getActivityStats, getDangerousActions } from "../governance/system-monitor.js";
import { scanInput } from "../governance/prompt-guard.js";
import { scan } from "../governance/guardrails.js";

export default class GovernanceAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.name = "governance";
    this.prefix = (config.id || config.connectionId || "governance");
  }

  async connect() { return true; }
  async disconnect() {}
  async testConnection() { return { ok: true, message: "Governance engine active" }; }

  getTools() {
    const p = this.prefix;
    return [
      {
        name: `${p}__query_audit_logs`,
        description: "Query the governance audit log. Filter by date, tool, agent, connection, blocked status. Returns tool call history with timing, status, findings.",
        inputSchema: {
          type: "object",
          properties: {
            startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
            endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
            toolName: { type: "string", description: "Filter by tool name" },
            agentId: { type: "string", description: "Filter by agent ID" },
            blocked: { type: "boolean", description: "Filter blocked-only" },
            search: { type: "string", description: "Free text search" },
            limit: { type: "number", description: "Max results (default 50)" },
          },
        },
      },
      {
        name: `${p}__get_blocked_actions`,
        description: "Get a report of all blocked actions — tool calls that were denied by governance policies, prompt injection detection, or rate limiting. Includes breakdown by reason, tool, and agent.",
        inputSchema: {
          type: "object",
          properties: {
            startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
            endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
            limit: { type: "number", description: "Max results (default 100)" },
          },
        },
      },
      {
        name: `${p}__generate_security_report`,
        description: "Generate a comprehensive security & compliance report. Includes risk score, blocked actions, injection attempts, secret findings, policy status, recommendations. Available in JSON or Markdown format.",
        inputSchema: {
          type: "object",
          properties: {
            startDate: { type: "string", description: "Report start date (YYYY-MM-DD)" },
            endDate: { type: "string", description: "Report end date (YYYY-MM-DD)" },
            format: { type: "string", enum: ["json", "markdown"], description: "Output format (default: markdown)" },
          },
        },
      },
      {
        name: `${p}__get_governance_stats`,
        description: "Get real-time governance statistics — total calls, blocked, redacted, errors, breakdown by agent/tool/connection/day.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: `${p}__get_system_activity`,
        description: "Query the system activity monitor — tracks ALL AI actions including terminal commands, file writes, script executions, git operations. Independent of Snayu tool calls.",
        inputSchema: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["command", "file-write", "file-create", "file-delete", "script-exec"], description: "Filter by event type" },
            risk: { type: "string", enum: ["critical", "high", "medium", "low", "safe"], description: "Filter by risk level" },
            category: { type: "string", description: "Filter by category (git, network, filesystem, etc.)" },
            search: { type: "string", description: "Free text search" },
            limit: { type: "number", description: "Max results (default 50)" },
          },
        },
      },
      {
        name: `${p}__get_dangerous_actions`,
        description: "Get recent dangerous system actions detected — rm -rf, sudo, force push, remote script execution, etc. Critical for security audits.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max results (default 50)" },
          },
        },
      },
      {
        name: `${p}__scan_text_for_secrets`,
        description: "Scan any text for secrets, PII, and sensitive data. Returns findings with pattern names, severity, and categories.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to scan" },
          },
          required: ["text"],
        },
      },
      {
        name: `${p}__scan_for_prompt_injection`,
        description: "Scan text for prompt injection attempts, jailbreak patterns, and manipulation techniques. Returns risk score and detailed findings.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to scan for injection" },
          },
          required: ["text"],
        },
      },
      {
        name: `${p}__get_recent_alerts`,
        description: "Get recent governance alerts — policy violations, injection detections, secret findings. Shows what's been flagged.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max results (default 50)" },
          },
        },
      },
      {
        name: `${p}__get_pending_approvals`,
        description: "Get pending approval requests — tool calls waiting for human review. Shows tool, reason, expiry, and allows approve/reject.",
        inputSchema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["pending", "approved", "rejected", "expired"], description: "Filter by status (default: pending)" },
          },
        },
      },
      {
        name: `${p}__log_system_activity`,
        description: "Log an external AI action (terminal command, file write, script execution) to the system activity monitor. Use this to report actions taken outside Snayu.",
        inputSchema: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["command", "file-write", "file-create", "file-delete", "script-exec"], description: "Activity type" },
            content: { type: "string", description: "The command or file path" },
            source: { type: "string", description: "Source agent (e.g. copilot, cursor, terminal)" },
          },
          required: ["type", "content"],
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.replace(`${this.prefix}__`, "");

    switch (action) {
      case "query_audit_logs":
        return queryAuditLogs(params);
      case "get_blocked_actions":
        return getBlockedActionsReport(params);
      case "generate_security_report":
        return generateReport({ ...params, format: params.format || "markdown" });
      case "get_governance_stats":
        return getStats();
      case "get_system_activity":
        return queryActivity(params);
      case "get_dangerous_actions":
        return getDangerousActions(params.limit || 50);
      case "scan_text_for_secrets":
        return scan(params.text);
      case "scan_for_prompt_injection":
        return scanInput(params.text);
      case "get_recent_alerts":
        return getRecentAlerts(params.limit || 50);
      case "get_pending_approvals":
        return getApprovals({ status: params.status || "pending" });
      case "log_system_activity": {
        const { logActivity } = await import("../governance/system-monitor.js");
        return logActivity({ type: params.type, content: params.content, source: params.source || "external" });
      }
      default:
        throw new Error(`Unknown governance tool: ${action}`);
    }
  }
}
