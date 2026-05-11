/**
 * Base Adapter Interface.
 * 
 * Every service adapter must extend this class.
 * It provides a uniform interface for the MCP server to call.
 */

export class BaseAdapter {
  constructor(connection) {
    this.connection = connection;
    this.config = connection.config;
  }

  /** Test if the connection is valid. Returns { ok: boolean, message: string } */
  async testConnection() {
    throw new Error("testConnection() not implemented");
  }

  /** Return an array of MCP tool definitions this adapter provides */
  getTools() {
    throw new Error("getTools() not implemented");
  }

  /** Execute a tool by name with given params. Returns MCP-compatible response */
  async executeTool(toolName, params) {
    throw new Error(`Tool ${toolName} not implemented`);
  }

  /** Clean up resources */
  async disconnect() {
    // Override if needed
  }
}

// ─── Helper for MCP responses ────────────────────────────────────────────────
export function ok(data) {
  return {
    content: [{
      type: "text",
      text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
    }],
  };
}

export function err(msg) {
  return {
    content: [{ type: "text", text: `ERROR: ${msg}` }],
    isError: true,
  };
}
