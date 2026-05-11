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

## Supported Services (25+)

| Category | Services |
|----------|----------|
| 🗄️ **Databases** | PostgreSQL, MySQL, MongoDB, DynamoDB |
| ☁️ **Cloud** | Amazon S3, CloudWatch, SQS |
| 🔍 **Search** | Elasticsearch / OpenSearch |
| ⚙️ **DevOps** | GitHub, GitLab, Jira, Confluence |
| 💬 **Communication** | Slack, Microsoft Teams, SendGrid |
| 📈 **Monitoring** | Datadog, PagerDuty, Splunk |
| 🤖 **AI** | OpenAI |
| 🔧 **Custom** | Any REST API, Any Webhook, Snowflake, Redis, Notion, Kubernetes |

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
│   ├── adapters/                 # 25 service adapters
│   ├── mcp/
│   │   └── server.js             # MCP server + snayu dispatcher + wiki tools
│   └── web/
│       └── server.js             # Express dashboard + API
├── data/
│   ├── connections.json          # Persisted connections
│   └── built-agents.json         # Installed agents with systemPrompts
├── wiki/                         # LLM Wiki — persistent agent memory
│   ├── _index.md                 # Wiki table of contents
│   ├── architecture.md           # Tech stack, patterns, structure
│   ├── context.md                # Current state, handoff notes
│   ├── changelog.md              # Recent changes
│   └── repos/                    # Per-repo knowledge wikis
│       ├── _index.md             # Master repo index
│       └── <owner>__<repo>/      # One wiki per GitHub repo
│           ├── code-structure.md
│           ├── pr-reviews.md
│           ├── risk-map.md
│           └── standards.md
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

## Security

- Credentials stored locally in `data/connections.json`
- Passwords masked in API responses
- Database queries are read-only (SELECT only)
- All data stays on your machine
- AWS credentials auto-refresh from `~/.aws/credentials`

---

## License

MIT
