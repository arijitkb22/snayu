/**
 * Generic Webhook Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class WebhookAdapter extends BaseAdapter {
  _parseHeaders() {
    if (!this.config.headers) return {};
    try {
      return JSON.parse(this.config.headers);
    } catch {
      return {};
    }
  }

  async testConnection() {
    try {
      // Send a test ping to the webhook
      const res = await fetch(this.config.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this._parseHeaders() },
        body: JSON.stringify({ type: "test", source: "snayu", timestamp: new Date().toISOString() }),
      });
      return { ok: res.ok, message: res.ok ? `Webhook responded (HTTP ${res.status})` : `Webhook failed (HTTP ${res.status})` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__send`,
        description: `Send data to webhook (${this.connection.name})`,
        schema: {
          payload: z.record(z.any()).describe("JSON payload to send"),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    try {
      const res = await fetch(this.config.url, {
        method: this.config.method || "POST",
        headers: { "Content-Type": "application/json", ...this._parseHeaders() },
        body: JSON.stringify(params.payload),
      });
      const contentType = res.headers.get("content-type") || "";
      let data;
      if (contentType.includes("json")) {
        data = await res.json();
      } else {
        data = await res.text();
      }
      return ok({ status: res.status, data });
    } catch (e) {
      return err(e.message);
    }
  }
}
