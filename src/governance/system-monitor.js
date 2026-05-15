/**
 * System Activity Monitor — Tracks ALL AI actions beyond Snayu tool calls.
 * 
 * Monitors:
 *   - Terminal command executions
 *   - File write/create/delete operations
 *   - Script executions (Python, Node, shell)
 *   - Git operations
 *   - Network requests (curl, wget)
 *   - Package installations (npm, pip)
 *   - Dangerous patterns (rm -rf, sudo, chmod 777, etc.)
 * 
 * This creates a separate audit trail from tool calls — captures what
 * AI agents do outside the Snayu pipeline (e.g., Copilot running terminal
 * commands, Cursor editing files, etc.)
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "../../data/governance/activity");

function ensureDir() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

// ─── Risk Classification ─────────────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+-rf\s+[/~]|rm\s+-rf\s+\*/i, risk: "critical", category: "destructive", name: "Recursive force delete" },
  { pattern: /sudo\s+/i, risk: "high", category: "privilege", name: "Sudo execution" },
  { pattern: /chmod\s+777/i, risk: "high", category: "permission", name: "World-writable permissions" },
  { pattern: /curl\s+.*\|\s*(?:bash|sh|zsh)/i, risk: "critical", category: "remote-exec", name: "Pipe URL to shell" },
  { pattern: /wget\s+.*-O\s*-\s*\|\s*(?:bash|sh)/i, risk: "critical", category: "remote-exec", name: "Remote script execution" },
  { pattern: /eval\s*\(/i, risk: "high", category: "code-exec", name: "Dynamic eval" },
  { pattern: /exec\s*\(/i, risk: "medium", category: "code-exec", name: "Process exec" },
  { pattern: /\.env|process\.env|os\.environ/i, risk: "medium", category: "secrets", name: "Environment variable access" },
  { pattern: /DROP\s+(?:TABLE|DATABASE|SCHEMA)/i, risk: "critical", category: "destructive", name: "SQL drop" },
  { pattern: /TRUNCATE\s+/i, risk: "high", category: "destructive", name: "SQL truncate" },
  { pattern: /mkfs|fdisk|dd\s+if=/i, risk: "critical", category: "destructive", name: "Disk operation" },
  { pattern: /iptables|firewall-cmd|ufw/i, risk: "high", category: "network", name: "Firewall modification" },
  { pattern: /ssh-keygen|ssh-add|ssh\s+/i, risk: "medium", category: "access", name: "SSH operation" },
  { pattern: /git\s+push\s+.*--force/i, risk: "high", category: "git", name: "Force push" },
  { pattern: /git\s+reset\s+--hard/i, risk: "high", category: "git", name: "Hard reset" },
  { pattern: /npm\s+publish|pip\s+upload/i, risk: "medium", category: "publish", name: "Package publish" },
  { pattern: /npm\s+install\s+(?!--save-dev).*-g/i, risk: "medium", category: "install", name: "Global package install" },
  { pattern: /passwd|chpasswd|useradd|userdel/i, risk: "critical", category: "user-mgmt", name: "User management" },
  { pattern: /(?:nc|ncat|netcat)\s+/i, risk: "high", category: "network", name: "Netcat usage" },
  { pattern: /base64\s+(?:-d|--decode)/i, risk: "medium", category: "obfuscation", name: "Base64 decode" },
];

const COMMAND_CATEGORIES = [
  { pattern: /^(?:node|python|python3|ruby|php|perl)\s+/i, category: "script-execution" },
  { pattern: /^(?:npm|yarn|pnpm|pip|pip3|conda|brew)\s+/i, category: "package-management" },
  { pattern: /^git\s+/i, category: "git" },
  { pattern: /^(?:curl|wget|fetch|http)\s+/i, category: "network" },
  { pattern: /^(?:docker|podman|kubectl)\s+/i, category: "container" },
  { pattern: /^(?:cat|less|more|head|tail|grep|find|ls|pwd)\s+/i, category: "read" },
  { pattern: /^(?:mkdir|touch|cp|mv|rm|chmod|chown)\s+/i, category: "filesystem" },
  { pattern: /^(?:echo|printf|export|set|env)\s+/i, category: "shell" },
  { pattern: /^(?:psql|mysql|mongo|redis-cli|sqlite3)\s+/i, category: "database" },
  { pattern: /^(?:ssh|scp|rsync|sftp)\s+/i, category: "remote-access" },
  { pattern: /^(?:terraform|ansible|pulumi|cdk)\s+/i, category: "infrastructure" },
];

// ─── In-memory stats ─────────────────────────────────────────────────────────

const stats = {
  totalEvents: 0,
  byType: {},         // command, file-write, file-create, file-delete, script-exec
  byCategory: {},     // git, network, filesystem, etc.
  byRisk: { critical: 0, high: 0, medium: 0, low: 0, safe: 0 },
  dangerousActions: [],  // last 50 dangerous actions
};

// ─── Logging ─────────────────────────────────────────────────────────────────

/**
 * Log a system activity event.
 * @param {object} event
 *   type: "command" | "file-write" | "file-create" | "file-delete" | "script-exec"
 *   content: the command or file path
 *   source: "terminal" | "editor" | "api" | "unknown"
 *   agentId: optional
 */
export function logActivity(event) {
  ensureDir();

  const { type, content, source = "unknown", agentId } = event;

  // Classify
  const risks = classifyRisks(content);
  const category = classifyCategory(content, type);
  const maxRisk = risks.length > 0
    ? risks.reduce((max, r) => {
        const order = { critical: 4, high: 3, medium: 2, low: 1 };
        return (order[r.risk] || 0) > (order[max.risk] || 0) ? r : max;
      }).risk
    : "safe";

  const entry = {
    timestamp: new Date().toISOString(),
    type,
    category,
    content: content.length > 500 ? content.substring(0, 500) + "...[truncated]" : content,
    source,
    agentId,
    risk: maxRisk,
    risks: risks.map(r => ({ name: r.name, risk: r.risk, category: r.category })),
  };

  // Write to daily log file
  const date = new Date().toISOString().split("T")[0];
  const logFile = join(LOG_DIR, `activity-${date}.jsonl`);
  appendFileSync(logFile, JSON.stringify(entry) + "\n");

  // Update stats
  stats.totalEvents++;
  stats.byType[type] = (stats.byType[type] || 0) + 1;
  stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
  stats.byRisk[maxRisk] = (stats.byRisk[maxRisk] || 0) + 1;

  if (maxRisk !== "safe") {
    stats.dangerousActions.unshift(entry);
    if (stats.dangerousActions.length > 50) stats.dangerousActions.pop();
  }

  return entry;
}

/**
 * Query activity logs.
 */
export function queryActivity({ startDate, endDate, type, category, risk, search, limit = 100, offset = 0 } = {}) {
  ensureDir();
  const files = readdirSync(LOG_DIR).filter(f => f.startsWith("activity-") && f.endsWith(".jsonl")).sort().reverse();

  const results = [];
  for (const file of files) {
    const date = file.replace("activity-", "").replace(".jsonl", "");
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;

    const lines = readFileSync(join(LOG_DIR, file), "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (type && entry.type !== type) continue;
        if (category && entry.category !== category) continue;
        if (risk && entry.risk !== risk) continue;
        if (search && !JSON.stringify(entry).toLowerCase().includes(search.toLowerCase())) continue;
        results.push(entry);
      } catch {}
    }
  }

  results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return results.slice(offset, offset + limit);
}

/**
 * Get activity stats.
 */
export function getActivityStats() {
  return { ...stats };
}

/**
 * Get dangerous actions.
 */
export function getDangerousActions(limit = 50) {
  return stats.dangerousActions.slice(0, limit);
}

// ─── Classification ──────────────────────────────────────────────────────────

function classifyRisks(content) {
  if (!content) return [];
  return DANGEROUS_PATTERNS.filter(p => p.pattern.test(content));
}

function classifyCategory(content, type) {
  if (type === "file-write" || type === "file-create" || type === "file-delete") return "filesystem";
  for (const cat of COMMAND_CATEGORIES) {
    if (cat.pattern.test(content)) return cat.category;
  }
  return "other";
}

export { DANGEROUS_PATTERNS };
