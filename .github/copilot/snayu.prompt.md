---
description: "List all Snayu agents and run one"
mode: "agent"
tools: ["snayu"]
---

# Snayu Agent Launcher

Call the `snayu` tool with no arguments to show all available agents.

Then ask the user which agent they want to run and with what task.

## Agent Tags (copy-paste ready):

- `pr_review_agent` — Review PRs with inline GitHub comments
- `aws_infrastructure_investigator` — Investigate AWS infra issues  
- `incident_response_agent` — Rapid incident triage
- `defect_triage_agent` — Jira → investigate → fix → PR → Teams
- `bug_investigation_agent` — Cross-service bug investigation
- `database_performance_monitor` — PostgreSQL health check
- `service_health_checker` — Full system health check
- `security_log_scanner` — Security event scanning
- `schema_data_explorer` — Database schema exploration
- `quick_query_runner` — Run SQL, send to Teams
- `daily_standup_reporter` — Morning standup summary
- `daily_digest_to_teams` — End-of-day digest
- `cost_storage_analyzer` — Storage cost analysis
- `data_migration_validator` — Migration validation
- `environment_diff_agent` — Environment comparison
- `dead_code_unused_resource_detector` — Unused resource detection

## Steps:
1. Call `snayu` tool to show the full agent list
2. Ask user: "Which agent do you want to run?"
3. Once they pick one, call `snayu` with `agent` = their tag and `task` = their request
