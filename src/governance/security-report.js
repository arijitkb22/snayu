/**
 * Security Report Generator — Automated compliance & security reports.
 * 
 * Generates:
 *   - Executive summary with risk score
 *   - Blocked actions breakdown
 *   - Prompt injection attempts
 *   - Secret/PII findings
 *   - Policy violation timeline
 *   - Top risky agents/tools/connections
 *   - Recommendations
 */
import { queryAuditLogs, getStats, exportAuditCSV } from "./audit-log.js";
import { getPolicies } from "./policy-engine.js";
import { getRecentAlerts } from "./alerts.js";
import { getApprovals } from "./approvals.js";

/**
 * Generate a full security report for a time period.
 * @param {object} opts - { startDate, endDate, format: "json"|"markdown" }
 */
export function generateReport(opts = {}) {
  const {
    startDate = new Date(Date.now() - 86400000 * 7).toISOString().split("T")[0],
    endDate = new Date().toISOString().split("T")[0],
    format = "json",
  } = opts;

  const allLogsResult = queryAuditLogs({ startDate, endDate, limit: 10000 });
  const allLogs = allLogsResult.entries || allLogsResult || [];
  const stats = getStats();
  const policies = getPolicies();
  const alerts = getRecentAlerts(200);
  const approvals = getApprovals({ limit: 200 });

  // ── Metrics ────────────────────────────────────────────────────
  const totalCalls = allLogs.length;
  const blocked = allLogs.filter(l => l.blocked);
  const errors = allLogs.filter(l => l.success === false);
  const redacted = allLogs.filter(l => l.redactedInput || l.redactedOutput);
  const injections = allLogs.filter(l => l.promptInjection?.length > 0);
  const secretFindings = allLogs.filter(l => (l.inputFindings || 0) + (l.outputFindings || 0) > 0);
  const avgDuration = totalCalls > 0 ? Math.round(allLogs.reduce((s, l) => s + (l.durationMs || 0), 0) / totalCalls) : 0;

  // ── Top offenders ──────────────────────────────────────────────
  const blockedByTool = groupBy(blocked, "toolName");
  const blockedByAgent = groupBy(blocked, "agentId");
  const blockedByReason = groupBy(blocked, "blockReason");

  const toolUsage = groupBy(allLogs, "toolName");
  const agentUsage = groupBy(allLogs, "agentId");
  const connUsage = groupBy(allLogs, "connectionId");

  // ── Risk score (0-100) ─────────────────────────────────────────
  let riskScore = 0;
  if (totalCalls > 0) {
    const blockRate = blocked.length / totalCalls;
    const injectionRate = injections.length / totalCalls;
    const secretRate = secretFindings.length / totalCalls;
    riskScore = Math.min(100, Math.round(
      blockRate * 150 +
      injectionRate * 300 +
      secretRate * 100 +
      (errors.length / totalCalls) * 50
    ));
  }

  const riskLevel = riskScore >= 70 ? "CRITICAL" : riskScore >= 40 ? "HIGH" : riskScore >= 15 ? "MEDIUM" : "LOW";

  // ── Active policies summary ────────────────────────────────────
  const activePolicies = policies.filter(p => p.enabled);
  const disabledPolicies = policies.filter(p => !p.enabled);

  // ── Pending approvals ──────────────────────────────────────────
  const pendingApprovals = approvals.filter(a => a.status === "pending");
  const rejectedApprovals = approvals.filter(a => a.status === "rejected");

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      period: { startDate, endDate },
      version: "1.0.0",
    },
    executive: {
      riskScore,
      riskLevel,
      totalToolCalls: totalCalls,
      blockedActions: blocked.length,
      promptInjections: injections.length,
      secretsDetected: secretFindings.length,
      redactedCalls: redacted.length,
      errors: errors.length,
      avgResponseMs: avgDuration,
      activePolicies: activePolicies.length,
      pendingApprovals: pendingApprovals.length,
    },
    blockedActions: {
      total: blocked.length,
      byTool: sortedTopN(blockedByTool, 10),
      byAgent: sortedTopN(blockedByAgent, 10),
      byReason: sortedTopN(blockedByReason, 10),
      recent: blocked.slice(0, 20).map(b => ({
        timestamp: b.timestamp,
        toolName: b.toolName,
        reason: b.blockReason,
        agentId: b.agentId,
        connectionId: b.connectionId,
      })),
    },
    promptInjections: {
      total: injections.length,
      attempts: injections.slice(0, 20).map(i => ({
        timestamp: i.timestamp,
        toolName: i.toolName,
        patterns: i.promptInjection,
        agentId: i.agentId,
      })),
    },
    secretFindings: {
      total: secretFindings.length,
      inputFindings: secretFindings.filter(s => s.inputFindings).length,
      outputFindings: secretFindings.filter(s => s.outputFindings).length,
    },
    usage: {
      topTools: sortedTopN(toolUsage, 15),
      topAgents: sortedTopN(agentUsage, 10),
      topConnections: sortedTopN(connUsage, 10),
    },
    policies: {
      active: activePolicies.map(p => ({ id: p.id, name: p.name, action: p.action })),
      disabled: disabledPolicies.map(p => ({ id: p.id, name: p.name, action: p.action })),
    },
    approvals: {
      pending: pendingApprovals.length,
      rejected: rejectedApprovals.length,
      total: approvals.length,
    },
    recommendations: generateRecommendations({ riskScore, blocked, injections, secretFindings, activePolicies, disabledPolicies, totalCalls }),
  };

  if (format === "markdown") return reportToMarkdown(report);
  return report;
}

/**
 * Get just the blocked actions report.
 */
export function getBlockedActionsReport(opts = {}) {
  const { startDate, endDate, limit = 100 } = opts;
  const result = queryAuditLogs({ startDate, endDate, blocked: true, limit });
  const logs = result.entries || result || [];
  return {
    total: logs.length,
    actions: logs.map(l => ({
      timestamp: l.timestamp,
      toolName: l.toolName,
      reason: l.blockReason,
      agentId: l.agentId,
      connectionId: l.connectionId,
      policyId: l.policyId,
      promptInjection: l.promptInjection,
      durationMs: l.durationMs,
    })),
    byReason: sortedTopN(groupBy(logs, "blockReason"), 20),
    byTool: sortedTopN(groupBy(logs, "toolName"), 20),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupBy(arr, key) {
  const map = {};
  for (const item of arr) {
    const val = item[key] || "unknown";
    map[val] = (map[val] || 0) + 1;
  }
  return map;
}

function sortedTopN(map, n) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function generateRecommendations({ riskScore, blocked, injections, secretFindings, activePolicies, disabledPolicies, totalCalls }) {
  const recs = [];

  if (injections.length > 0) {
    recs.push({ severity: "critical", text: `${injections.length} prompt injection attempts detected. Review agent inputs and consider stricter input validation.` });
  }
  if (secretFindings.length > 5) {
    recs.push({ severity: "high", text: `${secretFindings.length} tool calls contained secrets/PII. Ensure credentials are passed via environment variables, not inline.` });
  }
  if (disabledPolicies.length > activePolicies.length) {
    recs.push({ severity: "medium", text: `${disabledPolicies.length} policies are disabled. Review and enable policies for better protection.` });
  }
  if (blocked.length === 0 && totalCalls > 50) {
    recs.push({ severity: "low", text: "No blocked actions detected. Consider adding stricter policies or enabling approval workflows for sensitive operations." });
  }
  if (riskScore >= 40) {
    recs.push({ severity: "high", text: `Risk score is ${riskScore}/100 (${riskScore >= 70 ? 'CRITICAL' : 'HIGH'}). Immediate review of governance policies recommended.` });
  }
  if (!activePolicies.some(p => p.action === "APPROVAL_REQUIRED")) {
    recs.push({ severity: "medium", text: "No approval workflows enabled. Consider requiring human approval for destructive or data-export operations." });
  }

  return recs;
}

function reportToMarkdown(r) {
  const lines = [
    `# 🛡️ Snayu Security Report`,
    `**Generated:** ${r.meta.generatedAt}  `,
    `**Period:** ${r.meta.period.startDate} → ${r.meta.period.endDate}`,
    ``,
    `## Executive Summary`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Risk Score | **${r.executive.riskScore}/100** (${r.executive.riskLevel}) |`,
    `| Total Tool Calls | ${r.executive.totalToolCalls} |`,
    `| Blocked Actions | ${r.executive.blockedActions} |`,
    `| Prompt Injections | ${r.executive.promptInjections} |`,
    `| Secrets Detected | ${r.executive.secretsDetected} |`,
    `| Redacted Calls | ${r.executive.redactedCalls} |`,
    `| Errors | ${r.executive.errors} |`,
    `| Avg Response | ${r.executive.avgResponseMs}ms |`,
    `| Active Policies | ${r.executive.activePolicies} |`,
    `| Pending Approvals | ${r.executive.pendingApprovals} |`,
    ``,
    `## Blocked Actions (${r.blockedActions.total})`,
    ...(r.blockedActions.byReason.length > 0
      ? [`| Reason | Count |`, `|--------|-------|`, ...r.blockedActions.byReason.map(b => `| ${b.name} | ${b.count} |`)]
      : [`_No blocked actions._`]),
    ``,
    `## Prompt Injection Attempts (${r.promptInjections.total})`,
    ...(r.promptInjections.attempts.length > 0
      ? r.promptInjections.attempts.map(a => `- **${a.toolName}** — ${a.patterns?.join(", ")} (${a.timestamp})`)
      : [`_None detected._`]),
    ``,
    `## Recommendations`,
    ...r.recommendations.map(rec => `- **[${rec.severity.toUpperCase()}]** ${rec.text}`),
    ``,
    `---`,
    `_Report generated by Snayu Governance Engine v${r.meta.version}_`,
  ];
  return lines.join("\n");
}
