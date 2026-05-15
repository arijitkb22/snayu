#!/usr/bin/env node

/**
 * Snayu — Universal MCP Server
 * 
 * This is THE universal MCP that plugs into any AI agent (GitHub Copilot,
 * Claude Desktop, Cursor, Windsurf, etc.). It dynamically exposes tools
 * from ALL configured connections.
 * 
 * "Connect once, use everywhere."
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getCatalog,
  getCatalogByCategory,
  getAllConnections,
  getActiveConnections,
  getServiceDefinition,
  saveConnection,
  deleteConnection,
  generateConnectionId,
} from "../core/registry.js";
import {
  initializeAll,
  collectAllTools,
  executeTool,
  testConnection,
  loadAdapter,
  unloadAdapter,
  reloadAll,
} from "../core/adapter-manager.js";
import { forceRefresh as forceAwsRefresh } from "../core/aws-credentials.js";
import {
  collectRegistryTools,
  executeRegistryTool,
  getAllRegistryAgents,
} from "../core/agent-registry.js";
import {
  collectBuiltAgentTools,
  collectBuiltAgentPrompts,
  executeAgent,
} from "../core/agent-builder.js";
import {
  initWiki,
  readPage,
  writePage,
  searchWiki,
  getCompactionPlan,
  wikiStatus,
  getBootstrapContext,
  PAGE_NAMES,
} from "../core/wiki.js";
import {
  initRepoWiki,
  readRepoPage,
  writeRepoPage,
  searchRepoWiki,
  repoWikiStatus,
  listRepoWikis,
  getRepoContext,
  initLocalRepoWiki,
  REPO_PAGE_NAMES,
} from "../core/repo-wiki.js";

// ─── Create server ───────────────────────────────────────────────────────────

// Bootstrap wiki context for instructions
initWiki();
const wikiBootstrap = getBootstrapContext();
const wikiInstructions = wikiBootstrap.hasWiki && wikiBootstrap.documented > 0
  ? `\n\n## LLM Wiki — Persistent Knowledge Base
You have access to a project wiki (${wikiBootstrap.documented}/${wikiBootstrap.totalPages} pages documented). 
IMPORTANT RULES:
1. At SESSION START: The wiki index and current context are below. Read specific pages with wiki_read when you need deeper info.
2. After MAKING CHANGES: Update the wiki — at minimum update "context" and "changelog" pages.
3. After SOLVING PROBLEMS: Document the fix in "troubleshooting".
4. After ARCHITECTURE DECISIONS: Document in "decisions".
5. NEVER let the wiki get stale — if you discover something wrong, fix it.
6. Keep entries concise. If a page is too long, compact it.

### Current Wiki Index
${wikiBootstrap.index?.split('\n').slice(0, 25).join('\n') || 'Empty'}

### Current Context
${wikiBootstrap.currentContext?.split('\n').slice(0, 20).join('\n') || 'No context yet'}`
  : `\n\n## LLM Wiki — Persistent Knowledge Base
A wiki is available but empty. After completing work, document what you learned using wiki_write. Pages: ${PAGE_NAMES.join(', ')}.`;

const server = new McpServer({
  name: "snayu",
  version: "1.0.0",
  description: "Snayu (স্নায়ু) — the nervous system for your AI agents. Connect once to your services, use them from any AI agent. Supports databases, cloud services, APIs, webhooks, and more.",
  instructions: `You have access to the Snayu agent platform. When the user mentions "snayu", wants to see available agents, or wants to run a specific agent — call the "snayu" tool.

- "snayu" with no arguments → shows all available agents
- "snayu" with an agent tag → runs that specific agent
- Examples: "snayu pr_review_agent — review PR #42", "snayu aws_infrastructure_investigator — check for errors"

IMPORTANT: When the user just types "snayu" by itself, call the snayu tool with no arguments to show the agent menu.${wikiInstructions}`,
});

// ═══════════════════════════════════════════════════════════════════════════════
// META TOOLS — Let the AI agent discover and manage connections
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "connector_list_services",
  "List all available services that can be connected. Shows the full catalog of supported integrations grouped by category.",
  {},
  async () => {
    const catalog = getCatalogByCategory();
    const result = {};
    for (const [category, services] of Object.entries(catalog)) {
      result[category] = services.map(s => ({
        id: s.id,
        name: s.name,
        icon: s.icon,
        description: s.description,
        connectionType: s.connectionType,
        requiredFields: s.fields.filter(f => f.required).map(f => f.key),
      }));
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "connector_get_service_fields",
  "Get the configuration fields required to connect to a specific service. Call this before configuring a new connection.",
  {
    serviceId: z.string().describe("Service ID from the catalog, e.g. 'postgresql', 'github', 'slack'"),
  },
  async ({ serviceId }) => {
    const svc = getServiceDefinition(serviceId);
    if (!svc) {
      return { content: [{ type: "text", text: `ERROR: Service '${serviceId}' not found` }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ service: svc.name, icon: svc.icon, fields: svc.fields }, null, 2) }],
    };
  }
);

server.tool(
  "connector_list_connections",
  "List all configured connections and their status (connected / configured / error).",
  {},
  async () => {
    const conns = getAllConnections();
    const summary = Object.values(conns).map(c => ({
      id: c.id,
      service: c.serviceId,
      name: c.name,
      status: c.status,
      lastTested: c.lastTestedAt,
      error: c.error,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    };
  }
);

server.tool(
  "connector_add_connection",
  "Add a new service connection. Provide the service ID, a friendly name, and the configuration fields required by that service.",
  {
    serviceId: z.string().describe("Service ID, e.g. 'postgresql', 'github', 'jira'"),
    name: z.string().describe("Friendly name for this connection, e.g. 'Production DB' or 'Work GitHub'"),
    config: z.record(z.any()).describe("Configuration object with the fields required by the service"),
  },
  async ({ serviceId, name, config }) => {
    const svc = getServiceDefinition(serviceId);
    if (!svc) {
      return { content: [{ type: "text", text: `ERROR: Service '${serviceId}' not found` }], isError: true };
    }

    // Validate required fields
    const missing = svc.fields.filter(f => f.required && !config[f.key]);
    if (missing.length > 0) {
      return {
        content: [{ type: "text", text: `ERROR: Missing required fields: ${missing.map(f => f.key).join(", ")}` }],
        isError: true,
      };
    }

    const connId = generateConnectionId(serviceId);
    saveConnection(connId, serviceId, config, name);

    // Load the adapter and test the connection
    const adapter = await loadAdapter(connId);
    let testResult = { ok: false, message: "No adapter available" };
    if (adapter) {
      testResult = await testConnection(connId);
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          connectionId: connId,
          name,
          serviceId,
          status: testResult.ok ? "connected" : "error",
          testResult,
          message: testResult.ok
            ? `✅ Successfully connected! The tools from '${name}' are now available.`
            : `⚠️ Connection saved but test failed: ${testResult.message}. You can fix the config and retry.`,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "connector_test_connection",
  "Test an existing connection to verify it's working.",
  {
    connectionId: z.string().describe("Connection ID to test"),
  },
  async ({ connectionId }) => {
    const result = await testConnection(connectionId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "connector_remove_connection",
  "Remove a service connection.",
  {
    connectionId: z.string().describe("Connection ID to remove"),
  },
  async ({ connectionId }) => {
    await unloadAdapter(connectionId);
    deleteConnection(connectionId);
    return {
      content: [{ type: "text", text: `Connection ${connectionId} removed.` }],
    };
  }
);

server.tool(
  "connector_refresh_aws",
  "Refresh AWS credentials for all AWS connections. Call this when you get 'security token expired' errors. Re-reads ~/.aws/credentials and reloads all AWS adapters.",
  {
    profile: z.string().optional().describe("AWS profile name (default: 'default')"),
  },
  async ({ profile }) => {
    const p = profile || "default";
    forceAwsRefresh(p);
    // Reload all AWS connections with this profile
    const allConns = getActiveConnections();
    const awsIds = ["cloudwatch","s3","dynamodb","sqs","lambda","ec2","rds","sns","ecs","route53","iam","eks"];
    let reloaded = 0;
    for (const conn of allConns) {
      const sid = conn.serviceId || "";
      const isAws = sid.startsWith("aws_") || awsIds.includes(sid);
      if (isAws && (conn.config?.profile || "default") === p) {
        try { await unloadAdapter(conn.id); } catch (_) {}
        try { await loadAdapter(conn.id); reloaded++; } catch (_) {}
      }
    }
    return {
      content: [{ type: "text", text: `AWS credentials refreshed for profile [${p}] — ${reloaded} connection(s) reloaded. Try your AWS operation again.` }],
    };
  }
);

server.tool(
  "connector_list_tools",
  "List all available tools from all active connections. This shows what the AI agent can currently do.",
  {},
  async () => {
    const tools = collectAllTools();
    const summary = tools.map(t => ({
      tool: t.name,
      description: t.description,
      service: t._serviceId,
      connection: t._connectionName,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// LLM WIKI — Persistent Knowledge Base Tools
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "wiki_read",
  "Read a wiki page. Pages: _index, architecture, agents, decisions, runbook, changelog, troubleshooting, context. Start with _index to see what's documented.",
  { page: z.string().describe("Page name: _index, architecture, agents, decisions, runbook, changelog, troubleshooting, context") },
  async ({ page }) => {
    const result = readPage(page);
    if (result.error) return { content: [{ type: "text", text: result.error }], isError: true };
    const header = `# 📖 Wiki: ${result.title}\n_${result.lines} lines · Last modified: ${result.lastModified}_\n${result.needsCompaction ? '⚠️ Page needs compaction (>' + MAX_LINES_DISPLAY + ' lines). Run wiki_compact.\n' : ''}\n---\n\n`;
    return { content: [{ type: "text", text: header + result.content }] };
  }
);

server.tool(
  "wiki_write",
  "Write to a wiki page. Use mode='append' to add new info, mode='replace' to rewrite. Always update 'context' and 'changelog' after making project changes. Pages: architecture, agents, decisions, runbook, changelog, troubleshooting, context.",
  {
    page: z.string().describe("Page name to write to"),
    content: z.string().describe("Markdown content to write. Be concise — max 20 lines per entry."),
    mode: z.enum(["append", "replace"]).optional().describe("'append' adds to end (default for changelog, troubleshooting), 'replace' overwrites entire page (use for architecture, context)"),
  },
  async ({ page, content, mode }) => {
    const writeMode = mode || (["changelog", "troubleshooting", "decisions"].includes(page) ? "append" : "replace");
    const result = await writePage(page, content, writeMode);
    if (result.error) return { content: [{ type: "text", text: result.error }], isError: true };
    return { content: [{ type: "text", text: result.message }] };
  }
);

server.tool(
  "wiki_search",
  "Search across all wiki pages for a keyword or phrase. Returns matching lines with context.",
  { query: z.string().describe("Search query — keyword, function name, error message, etc.") },
  async ({ query }) => {
    const result = searchWiki(query);
    if (result.matches === 0) return { content: [{ type: "text", text: `No matches for "${query}" in wiki.` }] };
    const output = [`## 🔍 Wiki Search: "${query}" — ${result.matches} match(es)\n`];
    for (const r of result.results) {
      output.push(`### ${r.title} (${r.page}) — line ${r.line}`);
      output.push("```");
      output.push(r.snippet);
      output.push("```\n");
    }
    return { content: [{ type: "text", text: output.join("\n") }] };
  }
);

server.tool(
  "wiki_status",
  "Check wiki health — which pages are documented, which need attention, which need compaction.",
  {},
  async () => {
    const status = wikiStatus();
    const lines = [`## 📊 Wiki Status — ${status.documented}/${status.totalPages} pages documented\n`];
    for (const p of status.pages) {
      const icon = !p.exists ? "❌" : p.isEmpty ? "📝" : p.needsCompaction ? "⚠️" : "✅";
      const info = p.exists ? `${p.lines} lines · ${new Date(p.lastModified).toLocaleDateString()}` : "not created";
      lines.push(`${icon} **${p.title}** (${p.page}) — ${info}`);
    }
    if (status.needsCompaction.length > 0) {
      lines.push(`\n⚠️ Pages needing compaction: ${status.needsCompaction.join(", ")}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "wiki_compact",
  "Get a compaction plan for an oversized wiki page. Returns old content to summarize and recent content to keep. You should then summarize the old content and call wiki_write with the combined result.",
  { page: z.string().describe("Page name to compact") },
  async ({ page }) => {
    const plan = getCompactionPlan(page);
    if (plan.error) return { content: [{ type: "text", text: plan.error }], isError: true };
    if (!plan.needsCompaction) return { content: [{ type: "text", text: plan.message }] };
    return {
      content: [{
        type: "text",
        text: [
          `## Compaction Plan for ${plan.page}`,
          `Total: ${plan.totalLines} lines (max: ${plan.maxLines})`,
          "",
          "### OLD CONTENT (summarize this into ~20 lines):",
          "```",
          plan.oldContent,
          "```",
          "",
          "### KEEP CONTENT (preserve this):",
          "```",
          plan.keepContent,
          "```",
          "",
          plan.instruction,
        ].join("\n"),
      }],
    };
  }
);

const MAX_LINES_DISPLAY = 200;

console.error("[mcp] Registered wiki tools (read, write, search, status, compact)");

// ═══════════════════════════════════════════════════════════════════════════════
// REPO WIKI — Per-Repository Knowledge Base
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "repo_wiki_init",
  "Initialize a knowledge wiki for a GitHub repo. Creates pages: code-structure, pr-reviews, risk-map, standards, changelog. Idempotent — safe to call if wiki already exists. Pass repo as 'owner/repo' or a GitHub URL.",
  { repo: z.string().describe("GitHub repo — 'owner/repo' or full URL") },
  async ({ repo }) => {
    try {
      const result = initRepoWiki(repo);
      if (result.exists) return { content: [{ type: "text", text: `✅ Wiki already exists for ${result.repo}. ${result.pages.length} pages ready. Use repo_wiki_read to load pages.` }] };
      return { content: [{ type: "text", text: `🆕 Created wiki for ${result.repo}. ${result.newPages} pages initialized. Pages: ${result.pages.join(", ")}` }] };
    } catch (e) { return { content: [{ type: "text", text: e.message }], isError: true }; }
  }
);

server.tool(
  "repo_wiki_init_local",
  "Initialize a local .snayu/wiki/ in a repo's workspace directory. This stores wiki knowledge alongside the code so it can be committed and shared with the team. Use when working directly in a cloned repo.",
  {
    workspacePath: z.string().describe("Absolute path to the repo's workspace/root directory"),
    repo: z.string().describe("GitHub repo — 'owner/repo' or full URL"),
  },
  async ({ workspacePath, repo }) => {
    try {
      const result = initLocalRepoWiki(workspacePath, repo);
      return { content: [{ type: "text", text: result.message }] };
    } catch (e) { return { content: [{ type: "text", text: e.message }], isError: true }; }
  }
);

server.tool(
  "repo_wiki_read",
  "Read a page from a repo's knowledge wiki. Pages: _index, code-structure, pr-reviews, risk-map, standards, changelog.",
  {
    repo: z.string().describe("GitHub repo — 'owner/repo' or full URL"),
    page: z.string().describe("Page: _index, code-structure, pr-reviews, risk-map, standards, changelog"),
  },
  async ({ repo, page }) => {
    try {
      const result = readRepoPage(repo, page);
      if (result.error) return { content: [{ type: "text", text: result.error }], isError: true };
      const header = `# 📦 ${result.repo} — ${result.title}\n_${result.lines} lines · Last modified: ${result.lastModified}_\n${result.needsCompaction ? '⚠️ Page is large. Consider compacting.\n' : ''}\n---\n\n`;
      return { content: [{ type: "text", text: header + result.content }] };
    } catch (e) { return { content: [{ type: "text", text: e.message }], isError: true }; }
  }
);

server.tool(
  "repo_wiki_write",
  "Write to a repo's knowledge wiki. Use 'append' for pr-reviews and changelog, 'replace' for code-structure, risk-map, standards.",
  {
    repo: z.string().describe("GitHub repo — 'owner/repo' or full URL"),
    page: z.string().describe("Page: code-structure, pr-reviews, risk-map, standards, changelog"),
    content: z.string().describe("Markdown content to write"),
    mode: z.enum(["append", "replace"]).optional().describe("'append' adds to end (default for pr-reviews, changelog), 'replace' overwrites"),
  },
  async ({ repo, page, content, mode }) => {
    try {
      const writeMode = mode || (["pr-reviews", "changelog"].includes(page) ? "append" : "replace");
      const result = await writeRepoPage(repo, page, content, writeMode);
      if (result.error) return { content: [{ type: "text", text: result.error }], isError: true };
      return { content: [{ type: "text", text: result.message }] };
    } catch (e) { return { content: [{ type: "text", text: e.message }], isError: true }; }
  }
);

server.tool(
  "repo_wiki_search",
  "Search across all pages of a repo's wiki for a keyword or phrase.",
  {
    repo: z.string().describe("GitHub repo — 'owner/repo' or full URL"),
    query: z.string().describe("Search keyword"),
  },
  async ({ repo, query }) => {
    try {
      const result = searchRepoWiki(repo, query);
      if (result.error) return { content: [{ type: "text", text: result.error }], isError: true };
      if (result.matches === 0) return { content: [{ type: "text", text: `No matches for "${query}" in ${result.repo} wiki.` }] };
      const output = [`## 🔍 ${result.repo} Wiki Search: "${query}" — ${result.matches} match(es)\n`];
      for (const r of result.results) {
        output.push(`### ${r.title} (${r.page}) — line ${r.line}`);
        output.push("```");
        output.push(r.snippet);
        output.push("```\n");
      }
      return { content: [{ type: "text", text: output.join("\n") }] };
    } catch (e) { return { content: [{ type: "text", text: e.message }], isError: true }; }
  }
);

server.tool(
  "repo_wiki_status",
  "Check status of a repo's knowledge wiki — which pages are filled, which need attention.",
  { repo: z.string().describe("GitHub repo — 'owner/repo' or full URL") },
  async ({ repo }) => {
    try {
      const status = repoWikiStatus(repo);
      if (!status.exists) return { content: [{ type: "text", text: status.message }] };
      const lines = [`## 📦 ${status.repo} Wiki — ${status.documented}/${status.totalPages} pages documented\n`];
      for (const p of status.pages) {
        const icon = !p.exists ? "❌" : p.isEmpty ? "📝" : p.needsCompaction ? "⚠️" : "✅";
        const info = p.exists ? `${p.lines} lines · ${new Date(p.lastModified).toLocaleDateString()}` : "not created";
        lines.push(`${icon} **${p.title}** (${p.page}) — ${info}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (e) { return { content: [{ type: "text", text: e.message }], isError: true }; }
  }
);

server.tool(
  "repo_wiki_context",
  "Load ALL existing knowledge for a repo in one call. Returns condensed content of all documented pages. Use this at the START of a PR review to get full repo context quickly.",
  { repo: z.string().describe("GitHub repo — 'owner/repo' or full URL") },
  async ({ repo }) => {
    try {
      const ctx = getRepoContext(repo);
      if (!ctx.exists) return { content: [{ type: "text", text: `No wiki for ${ctx.repo}. Will create during review. Use repo_wiki_init to set up.` }] };
      const output = [`# 🧠 ${ctx.repo} — Existing Knowledge (${ctx.documented}/${ctx.totalPages} pages)\n`];
      for (const [name, page] of Object.entries(ctx.pages)) {
        output.push(`## ${page.title} (${page.lines} lines)`);
        output.push(page.content);
        output.push("");
      }
      output.push(`\n💡 ${ctx.tip}`);
      return { content: [{ type: "text", text: output.join("\n") }] };
    } catch (e) { return { content: [{ type: "text", text: e.message }], isError: true }; }
  }
);

server.tool(
  "repo_wiki_list",
  "List all repos that have knowledge wikis.",
  {},
  async () => {
    const result = listRepoWikis();
    if (result.total === 0) return { content: [{ type: "text", text: "No repo wikis yet. Use repo_wiki_init to create one." }] };
    const lines = [`## 📚 Repo Wikis — ${result.total} repositories\n`];
    for (const r of result.repos) {
      lines.push(`- **${r.repo}** — ${r.documented}/${r.totalPages} pages documented · ${r.lastModified ? new Date(r.lastModified).toLocaleDateString() : 'N/A'}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

console.error("[mcp] Registered repo wiki tools (init, read, write, search, status, context, list)");

// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMIC TOOL REGISTRATION — Register tools from all active adapters + registry
// ═══════════════════════════════════════════════════════════════════════════════

async function registerDynamicTools() {
  // 1. Tools from connection adapters
  const adapterTools = collectAllTools();
  for (const tool of adapterTools) {
    try {
      server.tool(
        tool.name,
        tool.description,
        tool.schema,
        async (params) => {
          // Lazily capture client info on first tool call (handshake is complete by then)
          if (!mcpClientInfo) {
            try {
              mcpClientInfo = server.server.getClientVersion?.() || null;
              if (mcpClientInfo) console.error(`[snayu] Client: ${mcpClientInfo.name || 'unknown'} v${mcpClientInfo.version || '?'}`);
            } catch { /* not available */ }
          }
          const client = mcpClientInfo;
          return executeTool(tool.name, params, {
            callerClient: client?.name,
            callerVersion: client?.version,
            sessionId: mcpSessionId,
          });
        }
      );
    } catch (e) {
      console.error(`Could not register tool ${tool.name}: ${e.message}`);
    }
  }

  // 2. Registry agent tools — SKIPPED
  //    Registry agents' tools are already available as adapter tools above.
  //    Agents are invoked via built_agent__<tag> dispatch tools or the snayu dispatcher.
  //    Registering per-agent-prefixed copies would waste the 128 tool limit.
  const registryTools = collectRegistryTools();
  console.error(`[mcp] Registered ${adapterTools.length} adapter tool(s) (${registryTools.length} registry tools available but not duplicated)`);

  // 3. Built agents — registered as MCP PROMPTS + lightweight tools
  //    Prompts deliver the agent's systemPrompt so the LLM can plan & reason.
  //    Tools are kept as a fallback for direct execution.

  // 3a. Register MCP Prompts — the agent's brain
  const builtAgentPrompts = collectBuiltAgentPrompts() || [];
  for (const p of builtAgentPrompts) {
    try {
      server.prompt(
        p.name,
        p.description,
        { task: z.string().describe("The task or investigation to perform") },
        (params) => {
          const toolList = p._tools.map(t => `- \`${t}\``).join("\n");
          const systemMessage = [
            p._systemPrompt,
            "",
            "## AVAILABLE TOOLS",
            `You have access to these tools to complete the task. Call them as needed — plan your investigation, don't just fire them all blindly:`,
            toolList,
            "",
            "## USER TASK",
            params.task,
          ].join("\n");

          return {
            messages: [
              { role: "user", content: { type: "text", text: systemMessage } },
            ],
          };
        }
      );
    } catch (e) {
      console.error(`Could not register built agent prompt ${p.name}: ${e.message}`);
    }
  }

  // 3b. Register tools — these now return the agent's instructions + tool list
  //     so the LLM can plan, rather than executing everything server-side.
  const builtAgentTools = collectBuiltAgentTools() || [];
  for (const tool of builtAgentTools) {
    try {
      server.tool(
        tool.name,
        tool.description,
        tool.schema,
        async (params) => {
          const input = typeof params.input === "string" ? params.input : JSON.stringify(params);

          // If agent has a system prompt, return it as guidance for the LLM
          // The LLM should then call the individual tools itself
          if (tool._systemPrompt) {
            const toolList = tool._tools.map(t => `- \`${t}\``).join("\n");
            const guidance = [
              `# Agent: ${tool._agentName}`,
              "",
              tool._systemPrompt,
              "",
              "## AVAILABLE TOOLS",
              "Use these tools to complete the task. Plan your approach — call tools as needed based on findings:",
              toolList,
              "",
              "## USER TASK",
              input,
              "",
              "---",
              "**IMPORTANT**: Do NOT just return this text. Follow the instructions above and start calling the listed tools to investigate. Think step by step.",
            ].join("\n");

            return {
              content: [{ type: "text", text: guidance }],
            };
          }

          // Fallback: direct execution for agents without a systemPrompt
          const result = await executeAgent(tool._builtAgentId, { input });
          if (result.success) {
            return {
              content: [{ type: "text", text: JSON.stringify({ agent: tool._agentName, duration: result.duration, results: result.results }, null, 2) }],
            };
          } else {
            return {
              content: [{ type: "text", text: `ERROR from built agent "${tool._agentName}": ${result.error}` }],
              isError: true,
            };
          }
        }
      );
    } catch (e) {
      console.error(`Could not register built agent tool ${tool.name}: ${e.message}`);
    }
  }

  console.error(`[mcp] + ${builtAgentPrompts.length} built agent prompt(s) + ${builtAgentTools.length} built agent tool(s)`);

  // 4. SNAYU DISPATCHER — single tool, type "snayu" to see all agents
  //    "snayu" alone → shows agent menu
  //    "snayu pr_review_agent" → runs that agent directly
  if (builtAgentTools.length > 0) {
    const agentMap = {};
    for (const t of builtAgentTools) {
      const tag = t._agentName
        .replace(/[^\w\s]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .toLowerCase();
      agentMap[tag] = t;
    }

    const tags = Object.keys(agentMap);

    try {
      server.tool(
        "snayu",
        `Snayu Agent Platform — run any Snayu agent. Call with just a task to see available agents, or specify an agent tag to run it directly. When the user says "snayu" or asks about available agents or wants to run an agent, ALWAYS call this tool.`,
        {
          agent: z.string().optional().describe("Agent tag to run. Leave empty to see all available agents."),
          task: z.string().optional().describe("What you want the agent to do. Required when running an agent."),
        },
        async (params) => {
          const agentTag = (params.agent || "").trim().toLowerCase();

          // No agent specified → show the menu
          if (!agentTag) {
            const menu = [
              "# ⚡ Snayu — Available Agents",
              "",
              "Pick an agent by its **tag** and provide a task. Here are all available agents:",
              "",
              ...tags.map(tag => {
                const a = agentMap[tag];
                const toolCount = a._tools ? a._tools.length : 0;
                return `| \`${tag}\` | ${a._agentName} | ${toolCount} tools |`;
              }),
              "",
              "## How to use:",
              '- **"Use snayu agent `pr_review_agent` to review PR #42"**',
              '- **"Run snayu `aws_infrastructure_investigator` — checkout is timing out"**',
              '- **"snayu `incident_response_agent` check for errors in the last hour"**',
              "",
              "Just say which agent tag you want and what task to perform.",
            ].join("\n");
            return { content: [{ type: "text", text: menu }] };
          }

          // Fuzzy match — find best matching tag
          let tool = agentMap[agentTag];
          if (!tool) {
            // Try partial match
            const match = tags.find(t => t.includes(agentTag) || agentTag.includes(t));
            if (match) tool = agentMap[match];
          }
          if (!tool) {
            const menu = tags.map(t => `  • \`${t}\` → ${agentMap[t]._agentName}`).join("\n");
            return { content: [{ type: "text", text: `Unknown agent: "${agentTag}"\n\nAvailable agents:\n${menu}\n\nTry again with one of the tags above.` }], isError: true };
          }

          const task = (params.task || "").trim();
          if (!task) {
            const toolList = tool._tools.map(t => `  • \`${t}\``).join("\n");
            return { content: [{ type: "text", text: `# ${tool._agentName}\n\n${tool._systemPrompt ? tool._systemPrompt.split('\n').slice(0,3).join('\n') : 'No description.'}\n\n**Tools:** ${tool._tools.length}\n${toolList}\n\nProvide a task to run this agent. Example:\n"snayu ${agentTag} — investigate checkout timeouts"` }] };
          }

          // Run the agent
          if (tool._systemPrompt) {
            const toolList = tool._tools.map(t => `- \`${t}\``).join("\n");
            const guidance = [
              `# Agent: ${tool._agentName}`,
              "",
              tool._systemPrompt,
              "",
              "## AVAILABLE TOOLS",
              "Use these tools to complete the task. Plan your approach — call tools as needed based on findings:",
              toolList,
              "",
              "## USER TASK",
              task,
              "",
              "---",
              "**IMPORTANT**: Do NOT just return this text. Follow the instructions above and start calling the listed tools to investigate. Think step by step.",
            ].join("\n");
            return { content: [{ type: "text", text: guidance }] };
          }

          // Fallback: direct execution
          const result = await executeAgent(tool._builtAgentId, { input: task });
          if (result.success) {
            return { content: [{ type: "text", text: JSON.stringify({ agent: tool._agentName, duration: result.duration, results: result.results }, null, 2) }] };
          }
          return { content: [{ type: "text", text: `ERROR: ${result.error}` }], isError: true };
        }
      );
      console.error(`[mcp] Registered 'snayu' dispatcher with ${tags.length} agent tags: ${tags.join(", ")}`);
    } catch (e) {
      console.error(`[mcp] Could not register snayu dispatcher: ${e.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRY META-TOOL — Let AI agents discover onboarded developer agents
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "connector_list_registry_agents",
  "List all developer-onboarded agents and their tools. These agents extend Snayu with additional capabilities — their tools are available to all users automatically.",
  {},
  async () => {
    const agents = getAllRegistryAgents();
    const summary = agents.map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      author: a.author,
      version: a.version,
      status: a.status,
      protocol: a.protocol,
      tools: a.tools.map(t => ({ name: t.namespacedName, description: t.description })),
      lastHealthCheck: a.lastHealthCheck,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────
// Client info captured after MCP handshake
let mcpClientInfo = null;
// Session ID — unique per MCP process lifetime (one IDE connection = one session)
import crypto from "crypto";
const mcpSessionId = `ses_${crypto.randomBytes(8).toString("hex")}`;

async function main() {
  console.error("[snayu] Starting MCP server...");

  // Initialize all saved connections
  await initializeAll();

  // Register dynamic tools from adapters
  await registerDynamicTools();

  // Connect to transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[snayu] MCP server running — ready for AI agents");
}

/**
 * Get the current MCP client info (name, version).
 * Available after the MCP handshake completes.
 */
export function getMcpClientInfo() {
  return mcpClientInfo;
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
