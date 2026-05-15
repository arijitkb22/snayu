/**
 * Audit Logger — Append-only JSONL audit trail for every tool call.
 * 
 * Stores logs as daily rotated JSONL files in data/governance/audit/.
 * Each entry records: who called what, with what args, what happened,
 * how long it took, and which policies were evaluated.
 * 
 * Designed for compliance (SOC2, HIPAA, GDPR evidence).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.join(__dirname, "../../data/governance/audit");
const STATS_FILE = path.join(__dirname, "../../data/governance/stats.json");

// Ensure directories exist
if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });

// ─── SSE Live Feed ────────────────────────────────────────────────────────────
// Web server registers itself here so audit entries push to connected browsers.
const sseClients = new Set();

export function registerSseClient(res) {
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

function emitSseEvent(eventName, data) {
  if (sseClients.size === 0) return;
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

// ─── In-memory stats (rebuilt from logs on startup, flushed periodically) ────
let stats = rebuildStatsFromLogs();
let statsDirty = true; // mark dirty so startup rebuild is persisted immediately

function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, "utf-8"));
  } catch {
    return {
      totalCalls: 0,
      totalBlocked: 0,
      totalRedacted: 0,
      totalErrors: 0,
      byAgent: {},
      byConnection: {},
      byTool: {},
      byDay: {},
      lastUpdated: null,
    };
  }
}

/**
 * Rebuild in-memory stats by scanning all JSONL audit files.
 * Called on startup to reconcile stats with actual log data after a crash.
 */
function rebuildStatsFromLogs() {
  const fresh = {
    totalCalls: 0, totalBlocked: 0, totalRedacted: 0, totalErrors: 0,
    byAgent: {}, byConnection: {}, byTool: {}, byDay: {},
    totalTokens: 0, totalEstimatedCost: 0,
    tokensByDay: {}, costByDay: {},
    lastUpdated: null,
  };

  let files;
  try { files = fs.readdirSync(AUDIT_DIR).filter(f => f.endsWith('.jsonl')); }
  catch { return fresh; }

  for (const file of files) {
    let lines;
    try { lines = fs.readFileSync(path.join(AUDIT_DIR, file), 'utf-8').split('\n').filter(Boolean); }
    catch { continue; }

    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        const day = (r.timestamp || '').slice(0, 10);
        fresh.totalCalls++;
        if (r.blocked) fresh.totalBlocked++;
        if (r.redacted) fresh.totalRedacted++;
        if (r.error) fresh.totalErrors++;
        fresh.totalTokens += (r.totalTokens || 0);
        fresh.totalEstimatedCost += (r.estimatedCost || 0);
        if (day) {
          fresh.tokensByDay[day] = (fresh.tokensByDay[day] || 0) + (r.totalTokens || 0);
          fresh.costByDay[day] = (fresh.costByDay[day] || 0) + (r.estimatedCost || 0);
          fresh.byDay[day] = (fresh.byDay[day] || 0) + 1;
        }
        const agent = r.agentId || 'unknown';
        fresh.byAgent[agent] = (fresh.byAgent[agent] || 0) + 1;
        const conn = r.connectionId || 'unknown';
        fresh.byConnection[conn] = (fresh.byConnection[conn] || 0) + 1;
        const tool = r.toolName || 'unknown';
        fresh.byTool[tool] = (fresh.byTool[tool] || 0) + 1;
      } catch { /* skip malformed lines */ }
    }
  }

  // Round cost to 6dp
  fresh.totalEstimatedCost = Number(fresh.totalEstimatedCost.toFixed(6));
  for (const d of Object.keys(fresh.costByDay)) {
    fresh.costByDay[d] = Number(fresh.costByDay[d].toFixed(6));
  }

  console.log(`[audit] Rebuilt stats from logs: ${fresh.totalCalls} entries across ${files.length} file(s)`);
  return fresh;
}

function saveStats() {
  if (!statsDirty) return;
  stats.lastUpdated = new Date().toISOString();
  const dir = path.dirname(STATS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  statsDirty = false;
}

// Flush stats every 10 seconds (more frequent for cross-process visibility)
setInterval(saveStats, 10_000).unref?.();

// Flush on process exit
process.on("exit", saveStats);
process.on("SIGINT", () => { saveStats(); process.exit(0); });
process.on("SIGTERM", () => { saveStats(); process.exit(0); });

// ─── Logging ─────────────────────────────────────────────────────────────────

function getLogFile(date = new Date()) {
  const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(AUDIT_DIR, `audit-${day}.jsonl`);
}

/**
 * Write an audit log entry.
 */
export function writeAuditLog(entry) {
  const record = {
    id: `evt_${crypto.randomBytes(8).toString("hex")}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };

  // Append to daily JSONL file (sync — ensures durability on crash)
  const line = JSON.stringify(record) + "\n";
  try {
    fs.appendFileSync(getLogFile(), line);
  } catch (err) {
    console.error("[audit] Write error:", err.message);
  }

  // Update in-memory stats
  const day = record.timestamp.slice(0, 10);
  stats.totalCalls++;
  if (record.blocked) stats.totalBlocked++;
  if (record.redacted) stats.totalRedacted++;
  if (record.error) stats.totalErrors++;
  
  // Token & cost tracking
  stats.totalTokens = (stats.totalTokens || 0) + (record.totalTokens || 0);
  stats.totalEstimatedCost = Number(((stats.totalEstimatedCost || 0) + (record.estimatedCost || 0)).toFixed(6));
  if (!stats.tokensByDay) stats.tokensByDay = {};
  stats.tokensByDay[day] = (stats.tokensByDay[day] || 0) + (record.totalTokens || 0);
  if (!stats.costByDay) stats.costByDay = {};
  stats.costByDay[day] = Number(((stats.costByDay[day] || 0) + (record.estimatedCost || 0)).toFixed(6));

  const agent = record.agentId || "unknown";
  stats.byAgent[agent] = (stats.byAgent[agent] || 0) + 1;
  
  const conn = record.connectionId || "unknown";
  stats.byConnection[conn] = (stats.byConnection[conn] || 0) + 1;
  
  const tool = record.toolName || "unknown";
  stats.byTool[tool] = (stats.byTool[tool] || 0) + 1;
  
  stats.byDay[day] = (stats.byDay[day] || 0) + 1;
  statsDirty = true;

  // Push to any connected SSE dashboard clients in real-time
  emitSseEvent("audit", record);
  emitSseEvent("stats", {
    totalCalls: stats.totalCalls,
    totalBlocked: stats.totalBlocked,
    totalErrors: stats.totalErrors,
    totalTokens: stats.totalTokens || 0,
    totalEstimatedCost: stats.totalEstimatedCost || 0,
  });

  return record;
}

/**
 * Query audit logs with filters.
 */
export function queryAuditLogs({
  startDate,
  endDate,
  toolName,
  agentId,
  connectionId,
  blocked,
  search,
  limit = 100,
  offset = 0,
} = {}) {
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // default: last 7 days
  const end = endDate ? new Date(endDate) : new Date();
  
  // Collect matching log files
  const results = [];
  const files = fs.readdirSync(AUDIT_DIR)
    .filter(f => f.startsWith("audit-") && f.endsWith(".jsonl"))
    .sort()
    .reverse(); // newest first

  for (const file of files) {
    const fileDate = file.replace("audit-", "").replace(".jsonl", "");
    if (fileDate < start.toISOString().slice(0, 10)) break; // files are sorted desc, done
    if (fileDate > end.toISOString().slice(0, 10)) continue;

    let content;
    try { content = fs.readFileSync(path.join(AUDIT_DIR, file), "utf-8"); }
    catch { continue; }
    const lines = content.trim().split("\n").filter(Boolean);
    
    for (let i = lines.length - 1; i >= 0; i--) { // newest first
      try {
        const entry = JSON.parse(lines[i]);
        
        // Apply filters
        if (toolName && !entry.toolName?.includes(toolName)) continue;
        if (agentId && entry.agentId !== agentId) continue;
        if (connectionId && entry.connectionId !== connectionId) continue;
        if (blocked !== undefined && entry.blocked !== blocked) continue;
        if (search && !JSON.stringify(entry).toLowerCase().includes(search.toLowerCase())) continue;
        
        const ts = new Date(entry.timestamp);
        if (ts < start || ts > end) continue;
        
        results.push(entry);
      } catch { /* skip malformed lines */ }
    }
    if (results.length >= offset + limit) break; // have enough, stop reading more files
  }

  return {
    entries: results.slice(offset, offset + limit),
    total: results.length,
    hasMore: results.length > offset + limit,
  };
}

/**
 * Get governance stats — merges in-memory stats with persisted stats file
 * to handle cross-process scenarios (MCP writes, web server reads).
 */
export function getStats() {
  // Reload persisted stats from disk to pick up writes from other processes (e.g., MCP server)
  const persisted = loadStats();
  
  // Merge: use the larger of in-memory vs persisted for each counter
  const merged = {
    totalCalls: Math.max(stats.totalCalls, persisted.totalCalls || 0),
    totalBlocked: Math.max(stats.totalBlocked, persisted.totalBlocked || 0),
    totalRedacted: Math.max(stats.totalRedacted, persisted.totalRedacted || 0),
    totalErrors: Math.max(stats.totalErrors, persisted.totalErrors || 0),
    byAgent: { ...persisted.byAgent, ...stats.byAgent },
    byConnection: { ...persisted.byConnection, ...stats.byConnection },
    byTool: { ...persisted.byTool, ...stats.byTool },
    byDay: { ...persisted.byDay, ...stats.byDay },
    lastUpdated: stats.lastUpdated || persisted.lastUpdated,
    // Token & cost tracking
    totalTokens: Math.max(stats.totalTokens || 0, persisted.totalTokens || 0),
    totalEstimatedCost: Number(Math.max(stats.totalEstimatedCost || 0, persisted.totalEstimatedCost || 0).toFixed(6)),
    tokensByDay: { ...persisted.tokensByDay, ...stats.tokensByDay },
    costByDay: { ...persisted.costByDay, ...stats.costByDay },
  };

  // Merge individual counts (take max for each key)
  for (const key of ["byAgent", "byConnection", "byTool", "byDay"]) {
    for (const [k, v] of Object.entries(persisted[key] || {})) {
      merged[key][k] = Math.max(merged[key][k] || 0, v);
    }
  }
  // Merge tokensByDay and costByDay (take max per day)
  for (const [k, v] of Object.entries(persisted.tokensByDay || {})) {
    merged.tokensByDay[k] = Math.max(merged.tokensByDay[k] || 0, v);
  }
  for (const [k, v] of Object.entries(persisted.costByDay || {})) {
    merged.costByDay[k] = Math.max(merged.costByDay[k] || 0, v);
  }

  return merged;
}

/**
 * Get stats for a specific time range.
 */
export function getStatsForPeriod(days = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  
  const periodStats = { calls: 0, blocked: 0, byDay: {} };
  for (const [day, count] of Object.entries(stats.byDay)) {
    if (day >= cutoffStr) {
      periodStats.calls += count;
      periodStats.byDay[day] = count;
    }
  }
  return periodStats;
}

/**
 * Export audit logs as CSV.
 */
export function exportAuditCSV({ startDate, endDate } = {}) {
  const { entries } = queryAuditLogs({ startDate, endDate, limit: 10000 });
  const esc = (s) => `"${String(s || "").replace(/"/g, '""')}"`;
  const headers = "id,timestamp,service,action,connectionName,toolName,agentId,callerClient,inputSummary,outputSummary,durationMs,blocked,redacted,error\n";
  const rows = entries.map(e =>
    [e.id, e.timestamp, e.service||"", e.action||"", e.connectionName||"", e.toolName||"", e.agentId||"", e.callerClient||"", esc(e.inputSummary), esc(e.outputSummary), e.durationMs||0, !!e.blocked, !!e.redacted, e.error||""].join(",")
  ).join("\n");
  return headers + rows;
}

/**
 * Clean up old audit logs beyond retention period.
 */
export function cleanupLogs(retentionDays = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  
  let deleted = 0;
  const files = fs.readdirSync(AUDIT_DIR).filter(f => f.startsWith("audit-") && f.endsWith(".jsonl"));
  for (const file of files) {
    const fileDate = file.replace("audit-", "").replace(".jsonl", "");
    if (fileDate < cutoffStr) {
      fs.unlinkSync(path.join(AUDIT_DIR, file));
      deleted++;
    }
  }
  return { deleted, remaining: files.length - deleted };
}
