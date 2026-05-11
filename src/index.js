#!/usr/bin/env node

/**
 * Snayu (স্নায়ু) — Main Entry Point
 * 
 * The nervous system for your AI agents.
 * 
 * Starts both:
 * 1. Web UI for configuration (http://localhost:3456)
 * 2. Instructions for connecting the MCP server to AI agents
 */

import { startWebServer } from "./web/server.js";
import { initializeAll } from "./core/adapter-manager.js";
import { getAllConnections, getCatalog } from "./core/registry.js";
import { getAllAgentConfigs } from "./mcp/config-generator.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ⚡ Snayu (স্নায়ু)                                          ║
║      The nervous system for your AI agents.                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

  // Initialize all saved connections
  await initializeAll();

  const conns = getAllConnections();
  const active = Object.values(conns).filter(c => c.status === "connected").length;
  const total = Object.values(conns).length;
  const services = Object.keys(getCatalog()).length;

  console.log(`📊 Status: ${active} active / ${total} total connections | ${services} services available`);
  console.log("");

  // Start web UI
  await startWebServer();

  console.log("─────────────────────────────────────────────────────");
  console.log("");
  console.log("📋 To connect your AI agent, use one of these configs:");
  console.log("");

  const configs = getAllAgentConfigs();
  const mcpServerPath = path.resolve(__dirname, "mcp/server.js");

  console.log(`  VS Code Copilot:  .vscode/mcp.json`);
  console.log(`  Claude Desktop:   ~/Library/Application Support/Claude/claude_desktop_config.json`);
  console.log(`  Cursor:           ~/.cursor/mcp.json`);
  console.log(`  Windsurf:         ~/.codeium/windsurf/mcp_config.json`);
  console.log("");
  console.log(`  MCP Server Path:  ${mcpServerPath}`);
  console.log("");
  console.log("  Or visit the dashboard to copy ready-made configs.");
  console.log("─────────────────────────────────────────────────────");
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
