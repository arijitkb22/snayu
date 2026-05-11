/**
 * MCP Config Generator
 * 
 * Generates configuration files for different AI agents so
 * Snayu can be plugged in with zero friction.
 */

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_PATH = path.resolve(__dirname, "../mcp/server.js");

/**
 * Generate the mcp.json for VS Code GitHub Copilot.
 */
export function generateVSCodeConfig() {
  return {
    servers: {
      "snayu": {
        type: "stdio",
        command: "node",
        args: [MCP_SERVER_PATH],
      },
    },
  };
}

/**
 * Generate config for JetBrains IDEs (PyCharm, IntelliJ, RubyMine, WebStorm, etc.)
 * GitHub Copilot in JetBrains uses the same MCP config format as VS Code.
 */
export function generateJetBrainsConfig() {
  return {
    servers: {
      "snayu": {
        type: "stdio",
        command: "node",
        args: [MCP_SERVER_PATH],
      },
    },
  };
}

/**
 * Generate config for Claude Desktop.
 */
export function generateClaudeDesktopConfig() {
  return {
    mcpServers: {
      "snayu": {
        command: "node",
        args: [MCP_SERVER_PATH],
      },
    },
  };
}

/**
 * Generate config for Cursor IDE.
 */
export function generateCursorConfig() {
  return {
    mcpServers: {
      "snayu": {
        command: "node",
        args: [MCP_SERVER_PATH],
      },
    },
  };
}

/**
 * Generate config for Windsurf / Codeium.
 */
export function generateWindsurfConfig() {
  return {
    mcpServers: {
      "snayu": {
        command: "node",
        args: [MCP_SERVER_PATH],
      },
    },
  };
}

/**
 * Get all agent configs as a map.
 */
export function getAllAgentConfigs() {
  return {
    "vscode-copilot": {
      name: "VS Code — GitHub Copilot",
      file: ".vscode/mcp.json",
      config: generateVSCodeConfig(),
      instructions: "Create a .vscode/mcp.json file in your project root and paste this. Then open Copilot Chat in Agent mode.",
    },
    "jetbrains-copilot": {
      name: "JetBrains IDEs — GitHub Copilot (PyCharm, IntelliJ, RubyMine, WebStorm, etc.)",
      file: ".idea/mcp.json",
      config: generateJetBrainsConfig(),
      instructions: "Create a .idea/mcp.json file in your project root and paste this. Works with PyCharm, IntelliJ IDEA, RubyMine, WebStorm, GoLand, and all JetBrains IDEs with GitHub Copilot plugin. Then open Copilot Chat in Agent mode.",
    },
    "claude-desktop": {
      name: "Claude Desktop",
      file: "~/Library/Application Support/Claude/claude_desktop_config.json",
      config: generateClaudeDesktopConfig(),
      instructions: "Merge into your Claude Desktop config file, then restart Claude.",
    },
    cursor: {
      name: "Cursor IDE",
      file: "~/.cursor/mcp.json",
      config: generateCursorConfig(),
      instructions: "Add to your Cursor MCP configuration, then restart Cursor.",
    },
    windsurf: {
      name: "Windsurf / Codeium",
      file: "~/.codeium/windsurf/mcp_config.json",
      config: generateWindsurfConfig(),
      instructions: "Add to your Windsurf MCP configuration, then restart Windsurf.",
    },
  };
}
