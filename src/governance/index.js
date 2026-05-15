/**
 * Governance Middleware — wraps tool execution with the full pipeline:
 *   policy check → prompt guard → input guard → rate limit → approval → execute → output guard → alert → audit
 */
import { writeAuditLog, getStats } from "./audit-log.js";
import { scanObject } from "./guardrails.js";
import { evaluate } from "./policy-engine.js";
import { checkRate } from "./rate-limiter.js";
import { scanArgs as scanPromptInjection, scanOutput as scanOutputLeak } from "./prompt-guard.js";
import { fireAlert } from "./alerts.js";
import { queueApproval } from "./approvals.js";

let enabled = true;

// ─── Summarization helpers ───────────────────────────────────────────────────

/**
 * Build a concise human-readable summary of the tool input.
 * Captures the "what" without logging full payloads.
 */
function summarizeInput(action, args) {
  if (!args || typeof args !== "object") return undefined;
  const parts = [];

  // SQL queries
  if (args.sql) parts.push(`sql: ${truncate(args.sql, 120)}`);
  // Log searches
  if (args.logGroupName) parts.push(`logGroup: ${args.logGroupName}`);
  if (args.filterPattern) parts.push(`filter: "${args.filterPattern}"`);
  // Metric queries
  if (args.namespace) parts.push(`ns: ${args.namespace}`);
  if (args.metricName) parts.push(`metric: ${args.metricName}`);
  if (args.stat) parts.push(`stat: ${args.stat}`);
  if (args.dimensions) {
    const dims = args.dimensions.map(d => `${d.Name}=${d.Value}`).join(", ");
    parts.push(`dims: [${dims}]`);
  }
  // DynamoDB
  if (args.table) parts.push(`table: ${args.table}`);
  if (args.keyConditionExpression) parts.push(`key: ${args.keyConditionExpression}`);
  // S3
  if (args.bucket) parts.push(`bucket: ${args.bucket}`);
  if (args.key) parts.push(`key: ${args.key}`);
  if (args.prefix) parts.push(`prefix: ${args.prefix}`);
  // Teams / Slack
  if (args.title) parts.push(`title: "${truncate(args.title, 60)}"`);
  if (args.text && !args.sql) parts.push(`text: "${truncate(args.text, 80)}"`);
  // Time range
  if (args.startMinsAgo) parts.push(`last ${args.startMinsAgo}m`);
  if (args.limit) parts.push(`limit: ${args.limit}`);

  return parts.length > 0 ? parts.join(" | ") : undefined;
}

/**
 * Build a concise summary of the tool output.
 * Captures row counts, sizes, key indicators — never full data.
 */
function summarizeOutput(result) {
  if (result == null) return undefined;
  if (typeof result === "string") {
    if (result.startsWith("ERROR")) return truncate(result, 150);
    return `${result.length} chars`;
  }
  if (typeof result !== "object") return String(result);

  const parts = [];

  // Count-based results
  if (typeof result.count === "number") parts.push(`${result.count} results`);
  if (Array.isArray(result.entries)) parts.push(`${result.entries.length} entries`);
  if (Array.isArray(result.events)) parts.push(`${result.events.length} events`);
  if (Array.isArray(result.metrics)) parts.push(`${result.metrics.length} metrics`);
  if (Array.isArray(result.alarms)) parts.push(`${result.alarms.length} alarms`);
  if (Array.isArray(result.rows)) parts.push(`${result.rows.length} rows`);
  if (Array.isArray(result.items)) parts.push(`${result.items.length} items`);
  if (Array.isArray(result.datapoints)) parts.push(`${result.datapoints.length} datapoints`);
  if (Array.isArray(result.streams)) parts.push(`${result.streams.length} streams`);
  // Metric summaries
  if (result.summary && typeof result.summary === "object") {
    const s = result.summary;
    if (s.avg !== undefined) parts.push(`avg=${fmt(s.avg)}, max=${fmt(s.max)}`);
  }
  // Error results
  if (result.error) parts.push(`error: ${truncate(result.error, 100)}`);

  if (parts.length === 0) {
    const json = JSON.stringify(result);
    return `${json.length} chars`;
  }
  return parts.join(" | ");
}

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + "…";
}

function fmt(n) {
  if (n == null) return "?";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Number(n.toFixed(2)).toString();
}

// ─── Token & Cost Estimation ─────────────────────────────────────────────────

/**
 * Estimate token count from text. Uses ~4 chars per token heuristic
 * (accurate within ~20% for English text across GPT/Claude models).
 */
function estimateTokens(data) {
  if (data == null) return 0;
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return Math.ceil(text.length / 4);
}

/**
 * Model pricing per 1M tokens (USD). Updated May 2026.
 * Used for cost estimation — not exact billing.
 */
const MODEL_PRICING = {
  // OpenAI
  "gpt-4o":       { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":  { input: 0.15,  output: 0.60 },
  "gpt-4.1":      { input: 2.00,  output: 8.00 },
  "gpt-4.1-mini": { input: 0.40,  output: 1.60 },
  "gpt-4.1-nano": { input: 0.10,  output: 0.40 },
  "o3":           { input: 2.00,  output: 8.00 },
  "o3-mini":      { input: 1.10,  output: 4.40 },
  "o4-mini":      { input: 1.10,  output: 4.40 },
  // Anthropic
  "claude-sonnet-4": { input: 3.00, output: 15.00 },
  "claude-3.5-sonnet": { input: 3.00, output: 15.00 },
  "claude-3-opus":   { input: 15.00, output: 75.00 },
  "claude-3-haiku":  { input: 0.25, output: 1.25 },
  // Default fallback (mid-range estimate)
  "default":      { input: 3.00,  output: 12.00 },
};

/**
 * Estimate cost in USD for a tool call based on input/output token counts.
 */
function estimateCost(inputTokens, outputTokens, model) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["default"];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return Number((inputCost + outputCost).toFixed(6));
}

export function setEnabled(val) { enabled = val; }
export function isEnabled() { return enabled; }

/**
 * Wrap a tool execution function with governance.
 * @param {Function} executeFn - The original (toolName, args, connectionId) => result
 * @returns {Function} Governed version of executeFn
 */
export function governedExecute(executeFn) {
  return async function (toolName, args, connectionId, meta = {}) {
    if (!enabled) return executeFn(toolName, args, connectionId);
    if (meta._skipGovernance) return executeFn(toolName, args, connectionId);

    const start = Date.now();
    const { agentId, mode } = meta;

    // Extract service type from tool name (e.g. "aws_cloudwatch_prod__search_logs" → "aws_cloudwatch")
    const serviceType = connectionId?.replace(/_[a-z0-9]+$/, "") || toolName.split("__")[0];
    // Extract action name (e.g. "search_logs")
    const action = toolName.includes("__") ? toolName.split("__").pop() : toolName;

    // Build a human-readable input summary (key params, no huge payloads)
    const inputSummary = summarizeInput(action, args);

    const entry = {
      toolName, connectionId, agentId, timestamp: new Date().toISOString(),
      service: serviceType,
      action,
      connectionName: meta.connectionName || connectionId,
      callerClient: meta.callerClient || undefined,
      callerVersion: meta.callerVersion || undefined,
      sessionId: meta.sessionId || undefined,
      inputSummary,
    };

    try {
      // 1. Policy check (input direction)
      const inputPolicy = evaluate({ toolName, connectionId, agentId, args, mode, direction: "input" });
      if (inputPolicy?.action === "BLOCK") {
        entry.blocked = true;
        entry.blockReason = inputPolicy.reason;
        entry.policyId = inputPolicy.policyId;
        entry.durationMs = Date.now() - start;
        writeAuditLog(entry);
        fireAlert("policy_block", { toolName, reason: inputPolicy.reason, agentId, connectionId });
        return { error: `Blocked by policy: ${inputPolicy.reason}`, policyId: inputPolicy.policyId };
      }

      // 1b. Approval workflow
      if (inputPolicy?.action === "APPROVAL_REQUIRED") {
        const pending = queueApproval({ toolName, args, connectionId, agentId, reason: inputPolicy.reason, policyId: inputPolicy.policyId });
        entry.blocked = true;
        entry.blockReason = `Awaiting approval: ${pending.id}`;
        entry.durationMs = Date.now() - start;
        writeAuditLog(entry);
        return { error: `Approval required: ${inputPolicy.reason}`, approvalId: pending.id, status: "pending" };
      }

      // 2. Prompt injection detection
      const injectionScan = scanPromptInjection(args);
      if (!injectionScan.safe) {
        entry.blocked = true;
        entry.blockReason = `Prompt injection detected (score: ${injectionScan.score})`;
        entry.promptInjection = injectionScan.findings.map(f => f.name);
        entry.durationMs = Date.now() - start;
        writeAuditLog(entry);
        fireAlert("prompt_injection", { toolName, reason: entry.blockReason, agentId, connectionId, score: injectionScan.score, findings: injectionScan.findings });
        return { error: `Blocked: Prompt injection detected`, score: injectionScan.score, findings: injectionScan.findings.map(f => f.name) };
      }

      // 3. Input guardrails — scan args for secrets
      const inputScan = scanObject(args, { mode: inputPolicy?.action === "REDACT" ? "redact" : "detect" });
      if (inputScan.findings.length > 0) {
        entry.inputFindings = inputScan.findings.length;
        entry.redactedInput = inputScan.redacted;
        fireAlert("secret_detected", { toolName, reason: `${inputScan.findings.length} secret(s) found in input`, agentId, connectionId, findings: inputScan.findings });
      }

      // 4. Rate limiting
      const rateKey = `tool:${toolName}`;
      const rate = checkRate(rateKey);
      if (!rate.allowed) {
        entry.blocked = true;
        entry.blockReason = `Rate limit exceeded — retry in ${rate.retryAfterMs}ms`;
        entry.durationMs = Date.now() - start;
        writeAuditLog(entry);
        fireAlert("rate_limited", { toolName, reason: entry.blockReason, agentId, connectionId });
        return { error: entry.blockReason, retryAfterMs: rate.retryAfterMs };
      }

      // 5. Execute the actual tool
      const result = await executeFn(toolName, args, connectionId);

      // 6. Output guardrails — scan result for secrets + prompt leaks
      const outputPolicy = evaluate({ toolName, connectionId, agentId, direction: "output" });
      let finalResult = result;

      // Check for system prompt leakage in output
      if (typeof result === "string" || (result && typeof result === "object")) {
        const outputStr = typeof result === "string" ? result : JSON.stringify(result);
        const leakScan = scanOutputLeak(outputStr);
        if (!leakScan.safe) {
          entry.outputLeak = leakScan.findings.map(f => f.name);
          fireAlert("prompt_injection", { toolName, reason: "System prompt leak in output", agentId, connectionId, findings: leakScan.findings });
        }
      }

      if (outputPolicy?.action === "REDACT") {
        const outputScan = scanObject(result, { mode: "redact" });
        if (outputScan.findings.length > 0) {
          entry.outputFindings = outputScan.findings.length;
          entry.redactedOutput = true;
          finalResult = outputScan.clean;
        }
      }

      // 7. Audit log
      entry.success = true;
      entry.durationMs = Date.now() - start;
      entry.outputSummary = summarizeOutput(finalResult);

      // Token & cost estimation
      const inputTokens = estimateTokens(args);
      const outputTokens = estimateTokens(finalResult);
      entry.inputTokens = inputTokens;
      entry.outputTokens = outputTokens;
      entry.totalTokens = inputTokens + outputTokens;
      entry.estimatedCost = estimateCost(inputTokens, outputTokens, meta.model);
      if (meta.model) entry.model = meta.model;

      writeAuditLog(entry);

      return finalResult;

    } catch (err) {
      entry.success = false;
      entry.error = err.message;
      entry.durationMs = Date.now() - start;
      entry.inputTokens = estimateTokens(args);
      entry.outputTokens = estimateTokens(err.message);
      entry.totalTokens = (entry.inputTokens || 0) + (entry.outputTokens || 0);
      entry.estimatedCost = estimateCost(entry.inputTokens, entry.outputTokens, meta.model);
      writeAuditLog(entry);
      fireAlert("error", { toolName, reason: err.message, agentId, connectionId });
      throw err;
    }
  };
}

// Re-export for convenience
export { getStats } from "./audit-log.js";
export { getPolicies, addPolicy, updatePolicy, deletePolicy, resetPolicies } from "./policy-engine.js";
export { getBucketStats, resetBucket } from "./rate-limiter.js";
export { queryAuditLogs, exportAuditCSV, cleanupLogs, registerSseClient } from "./audit-log.js";
export { scan, redact } from "./guardrails.js";
export { PATTERNS } from "./patterns.js";
export { scanInput as scanPromptInjection, scanOutput as scanOutputLeak, INJECTION_PATTERNS } from "./prompt-guard.js";
export { fireAlert, getAlertConfig, updateAlertConfig, updateAlertRule, getRecentAlerts, clearRecentAlerts } from "./alerts.js";
export { queueApproval, approveRequest, rejectRequest, getApprovals, getPendingCount } from "./approvals.js";
