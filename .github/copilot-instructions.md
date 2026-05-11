# Snayu Agent Platform

You have access to the **Snayu agent platform** via the `snayu` MCP tool.

## Quick Start
- Type **"snayu"** or call the `snayu` tool with no arguments to see all available agents.
- To run an agent: `snayu <agent_tag> — <your task>`

## Available Agents

| Tag | Agent | What it does |
|-----|-------|-------------|
| `pr_review_agent` | 🔬 PR Review Agent | Reviews PRs with inline comments, suggestions, security scan |
| `aws_infrastructure_investigator` | 🏗️ AWS Infrastructure Investigator | Investigates CloudWatch alarms, metrics, logs, RDS health |
| `defect_triage_agent` | 🎯 Defect Triage Agent | Jira ticket → investigate → fix → PR → update Jira → notify Teams |
| `incident_response_agent` | 🚨 Incident Response Agent | Rapid triage during outages — logs, DB, DynamoDB, Teams alert |
| `bug_investigation_agent` | 🐛 Bug Investigation Agent | Cross-service bug investigation with Teams report |
| `service_health_checker` | 🏥 Service Health Checker | Health check across PostgreSQL, CloudWatch, DynamoDB, S3 |
| `database_performance_monitor` | � Database Performance Monitor | Table sizes, dead tuples, unused indexes, connections |
| `security_log_scanner` | � Security Log Scanner | Scans for failed logins, unauthorized access, privilege escalation |

## Important
When the user says "snayu" or asks to run an agent, ALWAYS call the `snayu` tool.

## LLM Wiki — Persistent Knowledge Base
This project has an **LLM Wiki** (`wiki/` folder) — a structured knowledge base maintained by AI agents.

**Rules:**
1. **Session start**: Call `wiki_read` on `_index` to see what's documented, then `context` for current state.
2. **After making changes**: Update `context` (current state) and `changelog` (what changed).
3. **After fixing bugs**: Document in `troubleshooting`.
4. **Architecture decisions**: Document in `decisions`.
5. **Keep it concise** — max 20 lines per entry.

**Wiki tools**: `wiki_read`, `wiki_write`, `wiki_search`, `wiki_status`, `wiki_compact`
**Pages**: `_index`, `architecture`, `agents`, `decisions`, `runbook`, `changelog`, `troubleshooting`, `context`

## Repo Wiki — Per-Repository Knowledge Base
Agents (especially PR Review) build **per-repo knowledge wikis** in `wiki/repos/<owner>__<repo>/`.

**How it works:**
1. When reviewing a repo for the first time → `repo_wiki_init` creates the wiki.
2. On subsequent reviews → `repo_wiki_context` loads all existing knowledge.
3. After each review → agent updates pages with new insights.
4. Knowledge compounds over time — risk scores, standards, recurring issues.

**Repo wiki tools**: `repo_wiki_init`, `repo_wiki_read`, `repo_wiki_write`, `repo_wiki_search`, `repo_wiki_status`, `repo_wiki_context`, `repo_wiki_list`
**Repo pages**: `_index`, `code-structure`, `pr-reviews`, `risk-map`, `standards`, `changelog`
