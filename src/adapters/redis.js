/**
 * Redis Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class RedisAdapter extends BaseAdapter {
  constructor(connection) {
    super(connection);
    this.client = null;
  }

  async _getClient() {
    if (this.client) return this.client;
    const { createClient } = await import("redis");
    const url = this.config.url || `redis://${this.config.host || "localhost"}:${this.config.port || 6379}`;
    this.client = createClient({ url, password: this.config.password || undefined });
    this.client.on("error", () => {});
    await this.client.connect();
    return this.client;
  }

  async testConnection() {
    try {
      const client = await this._getClient();
      const pong = await client.ping();
      return { ok: pong === "PONG", message: pong === "PONG" ? "Connected to Redis" : "Unexpected response" };
    } catch (e) { return { ok: false, message: e.message }; }
  }

  getTools() {
    const p = this.connection.id;
    return [
      { name: `${p}__get`, description: `Get a Redis key value (${this.connection.name})`, schema: { key: z.string().describe("Key name") } },
      { name: `${p}__set`, description: `Set a Redis key value (${this.connection.name})`, schema: { key: z.string(), value: z.string(), ttl: z.number().optional().describe("TTL in seconds") } },
      { name: `${p}__delete`, description: `Delete a Redis key (${this.connection.name})`, schema: { key: z.string() } },
      { name: `${p}__keys`, description: `List Redis keys matching a pattern (${this.connection.name})`, schema: { pattern: z.string().optional().default("*") } },
      { name: `${p}__info`, description: `Get Redis server info (${this.connection.name})`, schema: {} },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      const client = await this._getClient();
      switch (action) {
        case "get": { const val = await client.get(params.key); return ok({ key: params.key, value: val }); }
        case "set": {
          if (params.ttl) await client.setEx(params.key, params.ttl, params.value);
          else await client.set(params.key, params.value);
          return ok({ key: params.key, status: "set" });
        }
        case "delete": { const count = await client.del(params.key); return ok({ key: params.key, deleted: count }); }
        case "keys": { const keys = await client.keys(params.pattern || "*"); return ok({ pattern: params.pattern, count: keys.length, keys: keys.slice(0, 100) }); }
        case "info": { const info = await client.info(); return ok(info); }
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e.message); }
  }

  async disconnect() { if (this.client) await this.client.quit().catch(() => {}); }
}
