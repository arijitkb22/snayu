# Snayu Governance Layer — Technical Architecture

## How It Integrates

The governance layer wraps every `callTool()` invocation in the MCP server.
No adapter changes needed — governance is transparent middleware.

```
MCP Tool Call Request
        │
        ▼
┌─ GOVERNANCE PIPELINE ──────────────────────────────┐
│                                                     │
│  1. AUTHENTICATE  → Who is calling? (API key/agent) │
│  2. AUTHORIZE     → Is this agent allowed this tool?│
│  3. POLICY CHECK  → Does this violate any policy?   │
│  4. GUARD CHECK   → Secrets in args? Redact/block   │
│  5. RATE CHECK    → Within rate limits?              │
│  6. RISK SCORE    → High risk? → Approval workflow   │
│         │                                            │
│         ▼                                            │
│  7. EXECUTE       → Call the actual adapter          │
│         │                                            │
│         ▼                                            │
│  8. OUTPUT GUARD  → PII in results? Redact           │
│  9. AUDIT LOG     → Record everything                │
│ 10. METRICS       → Update usage counters            │
│                                                     │
└─────────────────────────────────────────────────────┘
        │
        ▼
   MCP Tool Call Response
```

## File Structure

```
src/
  governance/
    index.js              — Main governance middleware (wraps callTool)
    audit-log.js          — Append-only audit logger with rotation
    policy-engine.js      — Rule evaluation engine
    guardrails.js         — Secret/PII detection & redaction
    rate-limiter.js       — Token bucket rate limiting
    risk-scorer.js        — Risk scoring for approval workflows
    acl.js                — Access control lists
    patterns.js           — Built-in regex patterns (secrets, PII)
    reports.js            — Compliance report generators
  
data/
    governance/
      audit/              — Audit log files (JSONL, rotated daily)
      policies.json       — Active policies
      acl.json            — Access control rules
      usage.json          — Usage counters per agent/connection
```

## Integration Point (src/mcp/server.js)

```javascript
// Before (current):
const result = await adapter.callTool(toolName, args);

// After (with governance):
const result = await governance.execute({
  toolName, args, adapter,
  agentId: request.agentId,
  connectionId: connection.id,
});
// governance.execute() runs the full pipeline above
```

## Policy Schema

```json
{
  "id": "no-destructive-sql",
  "name": "Block destructive SQL",
  "enabled": true,
  "priority": 1,
  "conditions": {
    "toolPattern": "*__query",
    "argMatch": {
      "sql": "(?i)(DROP|DELETE|TRUNCATE|ALTER|UPDATE)\\s"
    }
  },
  "action": "BLOCK",
  "message": "Destructive SQL blocked by policy",
  "notify": ["teams:security-channel"],
  "scope": {
    "connections": ["*"],
    "agents": ["*"],
    "tags": ["production"]
  }
}
```

## Audit Log Entry Schema

```json
{
  "id": "evt_abc123",
  "timestamp": "2026-05-13T14:30:00.000Z",
  "toolName": "postgresql_abc__query",
  "agentId": "built_agent__aws_infrastructure_investigator",
  "connectionId": "postgresql_abc",
  "connectionName": "Production DB",
  "serviceId": "postgresql",
  "args": { "sql": "SELECT count(*) FROM users" },
  "argsRedacted": false,
  "result": { "status": "ok", "rowCount": 1 },
  "resultRedacted": false,
  "duration": 142,
  "policies": {
    "evaluated": ["no-destructive-sql", "query-size-limit"],
    "blocked": [],
    "warnings": []
  },
  "riskScore": 12,
  "approved": null,
  "error": null
}
```

## Built-in Policy Templates

| Policy | What It Does | Default |
|--------|-------------|---------|
| `no-destructive-sql` | Block DROP/DELETE/TRUNCATE/ALTER | ON for production |
| `query-row-limit` | Block queries returning > N rows | 10,000 rows |
| `no-full-table-scan` | Block SELECT * without WHERE | OFF |
| `redact-pii-output` | Mask SSN, email, phone in results | ON |
| `redact-secrets-input` | Mask API keys, tokens in args | ON |
| `rate-limit-default` | Max 60 tool calls/min per agent | ON |
| `production-readonly` | Block all writes on prod connections | OFF |
| `business-hours-only` | Block prod access outside 9am-6pm | OFF |
| `no-lambda-invoke-prod` | Block Lambda invoke on prod functions | OFF |
| `notify-on-high-risk` | Alert Teams/Slack for risk > 70 | ON |

## Secret Patterns (Built-in)

| Pattern | Example | Detection |
|---------|---------|-----------|
| AWS Access Key | `AKIAIOSFODNN7EXAMPLE` | `AKIA[0-9A-Z]{16}` |
| AWS Secret Key | `wJalrXUtnFEMI/K7MDENG...` | 40-char base64 after `=` |
| GitHub Token | `ghp_xxxxxxxxxxxx` | `gh[ps]_[A-Za-z0-9_]{36,}` |
| Slack Token | `xoxb-xxx-xxx-xxx` | `xox[bprs]-[0-9a-zA-Z-]+` |
| Stripe Key | `sk_live_xxxx` | `sk_(live|test)_[0-9a-zA-Z]+` |
| Generic API Key | `api_key=xxxxx` | Key-value patterns |
| SSN | `123-45-6789` | `\d{3}-\d{2}-\d{4}` |
| Credit Card | `4111111111111111` | Luhn-valid 13-19 digits |
| Email | `user@example.com` | Standard email regex |
| Phone | `+1-555-123-4567` | International phone patterns |
| JWT | `eyJhbG...` | `eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]+` |
