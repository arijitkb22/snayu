/**
 * Datadog Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class DatadogAdapter extends BaseAdapter {
  _site() {
    return this.config.site || "datadoghq.com";
  }

  async _fetch(path, method = "GET", body = null) {
    const url = `https://api.${this._site()}/api/v1${path}`;
    const opts = {
      method,
      headers: {
        "DD-API-KEY": this.config.apiKey,
        "DD-APPLICATION-KEY": this.config.appKey,
        "Content-Type": "application/json",
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`Datadog API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async testConnection() {
    try {
      await this._fetch("/validate");
      return { ok: true, message: `Connected to Datadog (${this._site()})` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__search_logs`,
        description: `Search Datadog logs (${this.connection.name})`,
        schema: {
          query: z.string().describe("Log search query"),
          from: z.string().optional().default("now-1h").describe("Start time, e.g. 'now-1h'"),
          to: z.string().optional().default("now"),
          limit: z.number().optional().default(20),
        },
      },
      {
        name: `${prefix}__list_monitors`,
        description: `List Datadog monitors (${this.connection.name})`,
        schema: {
          query: z.string().optional().describe("Filter monitors by name or tag"),
        },
      },
      {
        name: `${prefix}__get_events`,
        description: `Get recent Datadog events (${this.connection.name})`,
        schema: {
          start: z.number().optional().describe("Start time (UNIX seconds). Defaults to 1 hour ago."),
          end: z.number().optional().describe("End time (UNIX seconds). Defaults to now."),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "search_logs": {
          const url = `https://api.${this._site()}/api/v2/logs/events/search`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "DD-API-KEY": this.config.apiKey,
              "DD-APPLICATION-KEY": this.config.appKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              filter: { query: params.query, from: params.from || "now-1h", to: params.to || "now" },
              page: { limit: params.limit || 20 },
            }),
          });
          if (!res.ok) throw new Error(`Datadog API ${res.status}`);
          const data = await res.json();
          return ok({ logs: data.data?.map(l => ({ id: l.id, message: l.attributes?.message, timestamp: l.attributes?.timestamp, status: l.attributes?.status })) });
        }
        case "list_monitors": {
          const path = params.query ? `/monitor?name=${encodeURIComponent(params.query)}` : "/monitor";
          const data = await this._fetch(path);
          return ok(data.map(m => ({ id: m.id, name: m.name, type: m.type, status: m.overall_state })));
        }
        case "get_events": {
          const now = Math.floor(Date.now() / 1000);
          const start = params.start || now - 3600;
          const end = params.end || now;
          const data = await this._fetch(`/events?start=${start}&end=${end}`);
          return ok(data.events?.map(e => ({ id: e.id, title: e.title, text: e.text, date: e.date_happened })));
        }
        default: return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
