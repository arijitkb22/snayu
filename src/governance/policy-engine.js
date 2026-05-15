/**
 * Policy Engine — Rule-based access control for tool execution.
 * 
 * Policies have conditions + actions:
 *   conditions: { toolPattern, connectionId, agentId, argMatch, timeWindow }
 *   action: "ALLOW" | "BLOCK" | "REDACT" | "AUDIT_ONLY"
 *   reason: string
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_FILE = join(__dirname, "../../data/governance/policies.json");

let policies = [];

function ensureDir() {
  const dir = dirname(POLICY_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  if (existsSync(POLICY_FILE)) {
    try { policies = JSON.parse(readFileSync(POLICY_FILE, "utf-8")); } catch { policies = []; }
  } else {
    policies = getDefaultPolicies();
    save();
  }
}

function save() {
  ensureDir();
  writeFileSync(POLICY_FILE, JSON.stringify(policies, null, 2));
}

// ─── Default Policies ────────────────────────────────────────────────────────

function getDefaultPolicies() {
  return [
    {
      id: "block-destructive-writes",
      name: "Block Destructive Writes in Read-Only",
      enabled: true,
      priority: 100,
      conditions: { toolPattern: "delete|drop|truncate|destroy|remove", mode: "readonly" },
      action: "BLOCK",
      reason: "Destructive operations blocked in read-only mode"
    },
    {
      id: "block-sql-mutations",
      name: "Block SQL Mutations in Read-Only",
      enabled: true,
      priority: 99,
      conditions: { argMatch: { key: "sql", pattern: "^\\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)" }, mode: "readonly" },
      action: "BLOCK",
      reason: "SQL mutations blocked in read-only mode"
    },
    {
      id: "redact-query-results",
      name: "Redact Secrets in Output",
      enabled: true,
      priority: 50,
      conditions: { direction: "output" },
      action: "REDACT",
      reason: "Auto-redact secrets found in tool output"
    },
    {
      id: "redact-input-secrets",
      name: "Redact Secrets in Input Logging",
      enabled: true,
      priority: 50,
      conditions: { direction: "input" },
      action: "REDACT",
      reason: "Auto-redact secrets found in tool input before audit logging"
    },
    {
      id: "audit-all",
      name: "Audit All Tool Calls",
      enabled: true,
      priority: 0,
      conditions: {},
      action: "AUDIT_ONLY",
      reason: "Log all tool executions for compliance"
    },
    {
      id: "block-iam-write",
      name: "Block IAM Write Operations",
      enabled: false,
      priority: 90,
      conditions: { toolPattern: "iam.*create|iam.*delete|iam.*attach|iam.*detach" },
      action: "BLOCK",
      reason: "IAM write operations require manual approval"
    },
    {
      id: "rate-limit-heavy",
      name: "Flag High-Volume Tools",
      enabled: false,
      priority: 30,
      conditions: { toolPattern: "scan|list_all|search_logs" },
      action: "AUDIT_ONLY",
      reason: "High-volume tools flagged for monitoring"
    },
    {
      id: "approve-data-export",
      name: "Approve Data Exports",
      enabled: false,
      priority: 85,
      conditions: { toolPattern: "export|download|get_file|dump" },
      action: "APPROVAL_REQUIRED",
      reason: "Data export operations require human approval"
    },
    {
      id: "approve-iam-changes",
      name: "Approve IAM Changes",
      enabled: false,
      priority: 95,
      conditions: { toolPattern: "iam.*create|iam.*delete|iam.*put|iam.*attach" },
      action: "APPROVAL_REQUIRED",
      reason: "IAM changes require human approval"
    },
  ];
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

/**
 * Evaluate policies against a tool execution context.
 * @param {object} ctx - { toolName, connectionId, agentId, args, mode, direction }
 * @returns {{ action: string, reason: string, policyId: string } | null}
 */
export function evaluate(ctx) {
  if (policies.length === 0) load();

  const applicable = policies
    .filter(p => p.enabled)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const policy of applicable) {
    if (matchesConditions(policy.conditions, ctx)) {
      if (policy.action === "AUDIT_ONLY") continue; // don't block/redact, just note
      return { action: policy.action, reason: policy.reason, policyId: policy.id };
    }
  }
  return null; // no blocking/redacting policy matched
}

function matchesConditions(cond, ctx) {
  if (!cond || Object.keys(cond).length === 0) return true;

  if (cond.toolPattern && ctx.toolName) {
    if (!new RegExp(cond.toolPattern, "i").test(ctx.toolName)) return false;
  }
  if (cond.connectionId && ctx.connectionId !== cond.connectionId) return false;
  if (cond.agentId && ctx.agentId !== cond.agentId) return false;
  if (cond.mode && ctx.mode !== cond.mode) return false;
  if (cond.direction && ctx.direction !== cond.direction) return false;

  if (cond.argMatch && ctx.args) {
    const { key, pattern } = cond.argMatch;
    const val = ctx.args[key];
    if (!val || !new RegExp(pattern, "i").test(String(val))) return false;
  }

  return true;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function getPolicies() {
  if (policies.length === 0) load();
  return policies;
}

export function addPolicy(policy) {
  if (policies.length === 0) load();
  policy.id = policy.id || `policy-${Date.now()}`;
  policies.push(policy);
  save();
  return policy;
}

export function updatePolicy(id, updates) {
  if (policies.length === 0) load();
  const idx = policies.findIndex(p => p.id === id);
  if (idx === -1) return null;
  policies[idx] = { ...policies[idx], ...updates };
  save();
  return policies[idx];
}

export function deletePolicy(id) {
  if (policies.length === 0) load();
  const before = policies.length;
  policies = policies.filter(p => p.id !== id);
  if (policies.length < before) { save(); return true; }
  return false;
}

export function resetPolicies() {
  policies = getDefaultPolicies();
  save();
  return policies;
}
