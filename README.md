# ⚡ Snayu (স্নায়ু) — AI Agent Platform

> **The nervous system for your AI agents.** Connect your services once, build agents that think, and run them from any IDE.

---

## What Is Snayu?

Snayu is a **Model Context Protocol (MCP) server** that gives AI agents (GitHub Copilot, Claude, Cursor, Windsurf) real-time access to your infrastructure — databases, cloud services, APIs, and more.

But it's more than a connector. Snayu includes a **no-code agent builder** with 16 pre-built agents that follow structured investigation protocols, ask clarifying questions before acting, and deliver results to your team.

---

## Quick Start

### 1. Install

```bash
# From npm (fastest)
npm install @arijitkb22/snayu

# Or clone the repo
git clone https://github.com/arijitkb22/snayu.git
cd snayu
npm install
```

### 2. Start the Web Dashboard

```bash
npm start
```

Opens at **http://localhost:3456** — configure connections, install agents, manage everything.

### 3. Connect to Your IDE

Add to your project's `.vscode/mcp.json` (update the path to where you cloned snayu):

```json
{
  "servers": {
    "snayu": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/snayu/src/mcp/server.js"]
    }
  }
}
```

Open Copilot Chat → **Agent mode** → all your services + agents are available!

---

## 🎯 Using Snayu Agents

### The `snayu` Dispatcher

Every IDE gets a single **`snayu`** tool. Just invoke it to see all agents:

```
You: snayu
→ Shows all 16 available agents with tags
```

To run a specific agent:

```
You: snayu pr_review_agent — review PR #42
You: snayu aws_infrastructure_investigator — checkout is timing out
You: snayu incident_response_agent — check for errors in the last hour
```

### Three Ways to Invoke

| Method | How | Works In |
|--------|-----|----------|
| **Natural language** | Just type `snayu` | VS Code (with copilot-instructions.md) |
| **Tool reference** | Type `#mcp_snayu_snayu` in chat | **Any IDE** with MCP configured |
| **Prompt shortcut** | Type `#snayu` | VS Code (with .github/copilot/snayu.prompt.md) |

> **Tip:** `#mcp_snayu_snayu` works universally across all IDEs — VS Code, Cursor, Windsurf, Claude Desktop. It forces the LLM to call the snayu tool directly.

### Available Agents

| Tag | Agent | What It Does |
|-----|-------|-------------|
| `pr_review_agent` | 🔬 PR Review Agent | Reviews PRs with inline GitHub comments, suggestion blocks, security scan, cross-references prod logs |
| `aws_infrastructure_investigator` | 🏗️ AWS Infrastructure Investigator | Acts like a Staff SRE — correlates alarms → metrics → logs → DB to find root cause |
| `incident_response_agent` | 🚨 Incident Response Agent | Rapid triage during outages — searches logs, checks DB, alerts Teams |
| `defect_triage_agent` | 🎯 Defect Triage Agent | Jira ticket → investigate → fix code → create PR → update Jira → notify Teams |
| `bug_investigation_agent` | 🐛 Bug Investigation Agent | Cross-service bug investigation with Teams report |
| `database_performance_monitor` | 📊 Database Performance Monitor | Table sizes, dead tuples, unused indexes, active connections |
| `service_health_checker` | 🏥 Service Health Checker | Full health check across PostgreSQL, CloudWatch, DynamoDB, S3 |
| `security_log_scanner` | �� Security Log Scanner | Scans for failed logins, unauthorized access, privilege escalation |
| `schema_data_explorer` | 🔍 Schema & Data Explorer | Deep-dive into database schema, tables, columns |
| `quick_query_runner` | ⚡ Quick Query Runner | Run a SQL query and send results to Teams |
| `daily_standup_reporter` | 📋 Daily Standup Reporter | Morning summary — overnight errors, DB activity |
| `daily_digest_to_teams` | 💬 Daily Digest to Teams | End-of-day digest — errors, DB stats, S3 changes |
| `cost_storage_analyzer` | 📈 Cost & Storage Analyzer | S3 buckets, PostgreSQL bloat, DynamoDB sizes |
| `data_migration_validator` | 🗄️ Data Migration Validator | Compare schemas, table structures, row counts |
| `environment_diff_agent` | 🔄 Environment Diff Agent | Compare two PostgreSQL environments before deployment |
| `dead_code_unused_resource_detector` | 🧹 Dead Code Detector | Find unused indexes, empty tables, wasted storage |

---

## 🧠 LLM Wiki — Persistent Memory for AI Agents

Snayu agents don't start from scratch every session. They build and maintain **persistent knowledge bases** that compound over time.

### Global Project Wiki

Every Snayu installation has a **global wiki** (`wiki/`) — 7 structured pages that agents read at session start and update after making changes:

| Page | What's Inside |
|------|--------------|
| `architecture` | Tech stack, folder structure, key patterns |
| `decisions` | Architecture decisions with rationale (ADR-lite) |
| `troubleshooting` | Known issues, fixes, gotchas |
| `runbook` | Common tasks, commands, deployment steps |
| `changelog` | Recent changes and updates |
| `context` | Current state, active work, handoff notes |
| `agents` | Agent configs, invocation methods |

**Tools:** `wiki_read`, `wiki_write`, `wiki_search`, `wiki_status`, `wiki_compact`

### Per-Repo Knowledge Wiki

Every GitHub repo gets its own wiki that the **PR Review agent** incrementally builds. Wikis can live **locally in your repo** (`.snayu/wiki/`) or centrally in Snayu's install directory.

#### Local Wiki (Recommended)

```bash
# Agent creates .snayu/wiki/ in your repo
# Commit it — your team's AI agents instantly get context
.snayu/
├── README.md           # Why this exists
└── wiki/
    ├── code-structure.md
    ├── pr-reviews.md
    ├── risk-map.md
    ├── standards.md
    └── changelog.md
```

**Tools:** `repo_wiki_init_local`, `repo_wiki_init`, `repo_wiki_read`, `repo_wiki_write`, `repo_wiki_search`, `repo_wiki_status`, `repo_wiki_context`, `repo_wiki_list`

### How Knowledge Compounds

1. **1st PR Review** → Agent analyzes repo, creates code-structure + standards pages
2. **After 5 reviews** → Risk map identifies fragile areas, recurring issues tracked
3. **After 10 reviews** → Risk scores are data-driven, reviews are deeply contextual
4. **Ongoing** → Every developer contributes, every review enriches the knowledge

### Shared Team Knowledge (Hosted)

When Snayu runs on a shared server, all developers read/write the **same wiki**:

```
Dev A (VS Code) ──MCP──┐
Dev B (Cursor)  ──MCP──┤──→ Snayu Server ──→ wiki/ (shared)
Dev C (Claude)  ──MCP──┘
```

- Concurrent write safety via in-memory locks
- Zero config for individual developers
- Knowledge from one dev's debug session helps another dev's PR review

---

## 🧠 How Agents Work

Snayu agents aren't rigid workflows — they're **prompt-driven**. Each agent carries a **systemPrompt** that tells the LLM exactly how to investigate.

### The Flow

```
You: "snayu pr_review_agent — review PR #42"
  ↓
Copilot calls snayu({ agent: "pr_review_agent", task: "review PR #42" })
  ↓
Snayu returns the agent's systemPrompt + tool list (NOT execution)
  ↓
Copilot reads the prompt → Phase 0: asks clarifying questions
  ↓
You answer → Copilot follows the investigation protocol
  ↓
Copilot calls individual tools (CloudWatch, PostgreSQL, GitHub API, Teams)
  ↓
Results delivered — inline PR comments, Teams alerts, RCA reports
```

### Phase 0: Context Before Action

Every agent starts with **Phase 0** — it asks targeted questions before doing any work:

**🔬 PR Review Agent asks:**
- "Any reference PR for team coding style?"
- "Do you have a coding standards doc?"
- "Specific concerns? Security, performance, breaking changes?"

**🏗️ Infrastructure Investigator asks:**
- "Any specific service to focus on?" (Lambda, ECS, RDS)
- "What symptoms are you seeing?" (timeouts, 5xx, OOM)
- "Any time window?" (last 30 min, since deploy)

---

## Supported Services (34+)

| Category | Services |
|----------|----------|
| 🗄️ **Databases** | PostgreSQL, MySQL, MongoDB, DynamoDB, Snowflake, Redis |
| ☁️ **AWS** | S3, CloudWatch, SQS, SNS, Lambda, EC2, ECS, EKS, RDS, IAM, Route53, DynamoDB |
| 🔍 **Search** | Elasticsearch / OpenSearch |
| ⚙️ **DevOps** | GitHub, GitLab, Jira, Confluence |
| 💬 **Communication** | Slack, Microsoft Teams, SendGrid |
| 📈 **Monitoring** | Datadog, PagerDuty, Splunk |
| 🤖 **AI** | OpenAI, Databricks |
| 🔧 **Custom** | Any REST API, Any Webhook, Notion, Kubernetes |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│           Your IDE (VS Code, Cursor, etc.)  │
│                                             │
│   You: "snayu pr_review_agent — review #42" │
│         ↓                                   │
│   Copilot ←→ MCP Protocol (stdio)           │
└──────────────────────┬──────────────────────┘
                       │
          ┌────────────▼────────────┐
          │   Snayu MCP Server      │
          │                         │
          │  ┌───────────────────┐  │
          │  │ snayu dispatcher  │  │  ← Single tool, 16 agents
          │  └───────────────────┘  │
          │  ┌───────────────────┐  │
          │  │ Adapter Tools     │  │  ← CloudWatch, PostgreSQL, S3...
          │  └───────────────────┘  │
          │  ┌───────────────────┐  │
          │  │ Meta Tools        │  │  ← Self-service connection mgmt
          │  └───────────────────┘  │
          └────────────┬────────────┘
                       │
     ┌─────────────────┼─────────────────┐
     │                 │                 │
┌────▼─────┐    ┌──────▼──────┐   ┌─────▼─────┐
│CloudWatch│    │ PostgreSQL  │   │  Teams    │
│ DynamoDB │    │ MySQL       │   │  Slack    │
│ S3, SQS  │    │ MongoDB     │   │  GitHub   │
└──────────┘    └─────────────┘   └───────────┘
```

---

## IDE Configuration

### VS Code / GitHub Copilot

`.vscode/mcp.json`:
```json
{
  "servers": {
    "snayu": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/connector/src/mcp/server.js"]
    }
  }
}
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "snayu": {
      "command": "node",
      "args": ["/path/to/connector/src/mcp/server.js"]
    }
  }
}
```

### Cursor / Windsurf

Same format as VS Code — place in `~/.cursor/mcp.json` or `.windsurf/mcp.json`.

---

## Project Structure

```
connector/
├── src/
│   ├── core/
│   │   ├── agent-builder.js      # Agent builder + MCP tool registration
│   │   ├── default-agents.js     # 16 agent templates with systemPrompts
│   │   ├── registry.js           # Service catalog & connection storage
│   │   ├── adapter-manager.js    # Adapter lifecycle management
│   │   ├── wiki.js               # Global LLM Wiki (persistent memory)
│   │   └── repo-wiki.js          # Per-repo knowledge wikis
│   ├── adapters/                 # 35 service adapters
│   ├── governance/               # 🛡️ Governance engine
│   │   ├── index.js              # 9-step pipeline middleware
│   │   ├── audit-log.js          # Crash-safe JSONL audit trail + token/cost tracking
│   │   ├── policy-engine.js      # Allow/deny rules by tool/agent/connection
│   │   ├── rate-limiter.js       # Token-bucket rate limits
│   │   ├── prompt-guard.js       # Injection & jailbreak detection
│   │   ├── guardrails.js         # Secrets & PII scanning
│   │   ├── approvals.js          # Human-in-the-loop approval queue
│   │   ├── alerts.js             # Real-time violation alerts
│   │   ├── security-report.js    # Compliance report generator
│   │   ├── system-monitor.js     # AI system action tracker
│   │   └── patterns.js           # Regex patterns for detection
│   ├── mcp/
│   │   └── server.js             # MCP server + snayu dispatcher + wiki tools
│   └── web/
│       └── server.js             # Express dashboard + API
├── data/
│   ├── connections.json          # Persisted connections
│   ├── built-agents.json         # Installed agents with systemPrompts
│   └── governance/
│       ├── stats.json            # Cumulative stats (calls, tokens, cost)
│       ├── alerts.json           # Recent governance alerts
│       ├── policies.json         # Policy rules
│       └── audit/
│           └── audit-YYYY-MM-DD.jsonl  # Daily append-only audit logs
├── wiki/                         # LLM Wiki — persistent agent memory
│   ├── _index.md
│   ├── architecture.md
│   ├── context.md
│   ├── changelog.md
│   └── repos/                    # Per-repo knowledge wikis
├── docs/                         # Architecture & strategy docs
│   ├── GOVERNANCE_ARCHITECTURE.md
│   ├── GOVERNANCE_STRATEGY.md
│   ├── MARKET_ANALYSIS.md
│   └── GREENFIELD_OPPORTUNITIES.md
├── Dockerfile
├── .github/
│   ├── copilot-instructions.md   # Auto-injected into Copilot conversations
│   └── copilot/snayu.prompt.md   # #snayu prompt shortcut
└── mcp.json                      # Ready-to-use MCP config
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the web dashboard + connector |
| `npm run mcp` | Run the MCP server directly |
| `npm run dev` | Start with auto-reload |

---

## 🛡️ Governance Engine

Snayu includes a production-grade **governance layer** that wraps every tool call with a full security and observability pipeline — before and after execution.

### The Pipeline

Every tool call flows through this chain:

```
Tool Call
   │
   ▼
[1] Policy Check      → Is this tool allowed for this agent/connection?
   │
   ▼
[2] Prompt Guard      → Scan input for injection attempts & jailbreaks
   │
   ▼
[3] Input Guard       → Scan args for secrets, PII, API keys
   │
   ▼
[4] Rate Limiter      → Enforce per-tool / per-connection call budgets
   │
   ▼
[5] Approval Gate     → Require human approval for destructive actions
   │
   ▼
[6] Execute           → Run the actual tool
   │
   ▼
[7] Output Guard      → Scan output for leaked secrets / sensitive data
   │
   ▼
[8] Alert Engine      → Fire alerts on policy violations or anomalies
   │
   ▼
[9] Audit Log         → Persist enriched entry to append-only JSONL
```

### Governance Modules

| Module | File | What It Does |
|--------|------|-------------|
| **Middleware** | `governance/index.js` | Orchestrates the full 9-step pipeline |
| **Audit Log** | `governance/audit-log.js` | Crash-safe append-only JSONL + stats |
| **Policy Engine** | `governance/policy-engine.js` | Allow/deny rules by tool, agent, connection |
| **Rate Limiter** | `governance/rate-limiter.js` | Token-bucket rate limits per tool/connection |
| **Prompt Guard** | `governance/prompt-guard.js` | Detects injection, jailbreak, manipulation |
| **Guardrails** | `governance/guardrails.js` | Scans for secrets, PII, API keys in I/O |
| **Approvals** | `governance/approvals.js` | Human-in-the-loop approval queue |
| **Alerts** | `governance/alerts.js` | Real-time alerts on violations & anomalies |
| **Security Report** | `governance/security-report.js` | Full security & compliance report generator |
| **System Monitor** | `governance/system-monitor.js` | Tracks all AI system actions independently |
| **Patterns** | `governance/patterns.js` | Regex patterns for secrets/PII detection |

### Audit Log — Every Tool Call, Fully Documented

Each audit entry is a rich JSON record stored in **daily-rotated JSONL files** at `data/governance/audit/audit-YYYY-MM-DD.jsonl`.

**Example entry:**
```json
{
  "id": "evt_3a9f12bc44e71a08",
  "timestamp": "2026-05-14T09:18:30.638Z",
  "toolName": "postgresql_mnz1wzbl__query",
  "action": "query",
  "service": "postgresql",
  "connectionName": "local postgres",
  "connectionId": "postgresql_mnz1wzbl",
  "callerClient": "Visual Studio Code",
  "callerVersion": "1.105.1",
  "inputSummary": "sql: SELECT current_database(), current_user, now() as server_time | limit: 100",
  "outputSummary": "329 chars",
  "durationMs": 12,
  "allowed": true,
  "blocked": false,
  "model": "claude-sonnet-4",
  "inputTokens": 87,
  "outputTokens": 17,
  "totalTokens": 104,
  "estimatedCost": 0.001059
}
```

**Every entry captures:**

| Field | Description |
|-------|-------------|
| `toolName` | Exact MCP tool called |
| `action` | Semantic action (query, search, scan, send…) |
| `service` | Service type (postgresql, cloudwatch, s3…) |
| `connectionName` | Human-readable connection name |
| `callerClient` | IDE that made the call (VS Code, Cursor…) |
| `callerVersion` | Exact IDE version |
| `inputSummary` | What was asked — no raw payloads, just intent |
| `outputSummary` | What was returned — row counts, char length |
| `durationMs` | Execution time |
| `allowed / blocked` | Policy decision |
| `model` | LLM model used for the session |
| `inputTokens / outputTokens / totalTokens` | Estimated token usage |
| `estimatedCost` | USD cost estimate for this call |

### Crash-Safe Writes

Audit writes use **`appendFileSync`** — the entry is fully on disk before execution returns. If the server crashes mid-session, no audit entries are lost.

On restart, stats are automatically **rebuilt from the JSONL files** — no stale in-memory counters.

### Token & Cost Tracking

Snayu estimates tokens and USD cost for every tool call using a **12-model pricing table**:

| Model | Input ($/1M tokens) | Output ($/1M tokens) |
|-------|--------------------|--------------------|
| `gpt-4o` | $2.50 | $10.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `claude-sonnet-4` | $3.00 | $15.00 |
| `claude-3.5-sonnet` | $3.00 | $15.00 |
| `claude-3-opus` | $15.00 | $75.00 |
| `claude-3-haiku` | $0.25 | $1.25 |
| *(+ 6 more)* | … | … |

Token estimation uses the `chars / 4` heuristic (±20% accuracy for English text). Costs accumulate in `data/governance/stats.json` and are visible in the dashboard.

### Governance Dashboard

The **Governance** tab in the dashboard (`http://localhost:3456`) shows:

- **Total Calls / Blocked / Errors / Redacted** — lifetime counters
- **Total Tokens (est.)** — cumulative token usage across all sessions
- **Est. Cost (USD)** — cumulative cost estimate
- **Audit Log Table** — every call with Time, Service, Action, Duration, Status
- **Detail Modal** — click any row to see full entry including token breakdown, input/output summary, caller info
- **CSV Export** — download the full audit log with all enriched fields

### Governance Tools (MCP)

These tools are available directly in your IDE via MCP:

| Tool | Description |
|------|-------------|
| `governance__generate_security_report` | Full security & compliance report with risk score |
| `governance__get_blocked_actions` | All denied tool calls with reasons |
| `governance__get_dangerous_actions` | Detected dangerous commands (rm -rf, sudo, force push…) |
| `governance__get_governance_stats` | Real-time stats — calls, blocked, cost, tokens |
| `governance__get_pending_approvals` | Tool calls awaiting human review |
| `governance__get_recent_alerts` | Recent policy violations and findings |
| `governance__get_system_activity` | Full AI action monitor (terminal, file writes, git ops) |
| `governance__query_audit_logs` | Query audit trail with filters |
| `governance__scan_for_prompt_injection` | Scan any text for injection/jailbreak attempts |
| `governance__scan_text_for_secrets` | Scan text for API keys, PII, credentials |

### Toggle Governance

```bash
# Via API
curl -X POST http://localhost:3456/api/governance/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

Or toggle the switch on the Governance dashboard tab.

---

## Security

- Credentials stored locally in `data/connections.json`
- Passwords masked in API responses
- Database queries are read-only (SELECT only)
- All data stays on your machine
- AWS credentials auto-refresh from `~/.aws/credentials`
- All AI tool calls logged to tamper-evident append-only JSONL audit trail
- Input/output scanned for secrets, PII, and prompt injection on every call

---

## License

MIT
