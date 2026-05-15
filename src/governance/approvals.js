/**
 * Approval Workflows — Human-in-the-loop for sensitive tool calls.
 * 
 * When a policy has action "APPROVAL_REQUIRED", the tool call is queued
 * and waits for manual approve/reject via dashboard or API.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fireAlert } from "./alerts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = join(__dirname, "../../data/governance/approvals.json");

let queue = [];

function ensureDir() {
  const dir = dirname(QUEUE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  if (existsSync(QUEUE_FILE)) {
    try { queue = JSON.parse(readFileSync(QUEUE_FILE, "utf-8")); } catch { queue = []; }
  }
}

function save() {
  ensureDir();
  writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

/**
 * Queue a tool call for approval.
 * Returns a pending approval entry.
 */
export function queueApproval({ toolName, args, connectionId, agentId, reason, policyId }) {
  if (queue.length === 0) load();

  const entry = {
    id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: "pending",    // pending | approved | rejected | expired
    toolName,
    args: sanitizeArgs(args),  // Don't store raw secrets
    connectionId,
    agentId,
    reason,
    policyId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour expiry
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  };

  queue.unshift(entry);

  // Keep queue manageable (max 500)
  if (queue.length > 500) queue = queue.slice(0, 500);
  save();

  // Fire alert
  fireAlert("approval_pending", { toolName, reason, agentId, connectionId });

  return entry;
}

/**
 * Approve a pending request.
 */
export function approveRequest(id, { decidedBy = "admin", note = "" } = {}) {
  if (queue.length === 0) load();
  const entry = queue.find(e => e.id === id);
  if (!entry) return null;
  if (entry.status !== "pending") return { error: `Already ${entry.status}` };

  entry.status = "approved";
  entry.decidedBy = decidedBy;
  entry.decidedAt = new Date().toISOString();
  entry.decisionNote = note;
  save();
  return entry;
}

/**
 * Reject a pending request.
 */
export function rejectRequest(id, { decidedBy = "admin", note = "" } = {}) {
  if (queue.length === 0) load();
  const entry = queue.find(e => e.id === id);
  if (!entry) return null;
  if (entry.status !== "pending") return { error: `Already ${entry.status}` };

  entry.status = "rejected";
  entry.decidedBy = decidedBy;
  entry.decidedAt = new Date().toISOString();
  entry.decisionNote = note;
  save();
  return entry;
}

/**
 * Get all approval entries.
 */
export function getApprovals({ status, limit = 50 } = {}) {
  if (queue.length === 0) load();

  // Auto-expire old pending entries
  const now = new Date().toISOString();
  let changed = false;
  for (const e of queue) {
    if (e.status === "pending" && e.expiresAt < now) {
      e.status = "expired";
      changed = true;
    }
  }
  if (changed) save();

  let result = queue;
  if (status) result = result.filter(e => e.status === status);
  return result.slice(0, limit);
}

/**
 * Get count of pending approvals.
 */
export function getPendingCount() {
  if (queue.length === 0) load();
  const now = new Date().toISOString();
  return queue.filter(e => e.status === "pending" && e.expiresAt >= now).length;
}

/**
 * Strip secrets from args before storing in approval queue.
 */
function sanitizeArgs(args) {
  if (!args) return {};
  const clean = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 200) {
      clean[k] = v.substring(0, 200) + "...[truncated]";
    } else {
      clean[k] = v;
    }
  }
  return clean;
}
