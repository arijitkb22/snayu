/**
 * Splunk Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class SplunkAdapter extends BaseAdapter {
  async _fetch(path, opts = {}) {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json", ...opts.headers },
    });
    if (!res.ok) throw new Error(`Splunk ${res.status}: ${await res.text()}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  }

  async testConnection() {
    try {
      await this._fetch("/services/server/info?output_mode=json");
      return { ok: true, message: "Connected to Splunk" };
    } catch (e) { return { ok: false, message: e.message }; }
  }

  getTools() {
    const p = this.connection.id;
    return [
      { name: `${p}__search`, description: `Run a Splunk search query (${this.connection.name})`, schema: {
        query: z.string().describe("SPL search query"), earliest: z.string().optional().default("-1h"), latest: z.string().optional().default("now"), maxResults: z.number().optional().default(100),
      }},
      { name: `${p}__list_indexes`, description: `List Splunk indexes (${this.connection.name})`, schema: {} },
      { name: `${p}__get_alerts`, description: `Get fired alerts (${this.connection.name})`, schema: { count: z.number().optional().default(20) } },
      { name: `${p}__list_saved_searches`, description: `List saved searches / reports (${this.connection.name})`, schema: {} },
      { name: `${p}__get_health`, description: `Get Splunk server health status (${this.connection.name})`, schema: {} },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "search": {
          // Create a oneshot search
          const searchQ = params.query.startsWith("search ") ? params.query : `search ${params.query}`;
          const body = new URLSearchParams({ search: searchQ, earliest_time: params.earliest || "-1h", latest_time: params.latest || "now", output_mode: "json", count: String(params.maxResults || 100) });
          const base = this.config.baseUrl.replace(/\/+$/, "");
          const res = await fetch(`${base}/services/search/jobs/export`, {
            method: "POST", headers: { Authorization: `Bearer ${this.config.token}` }, body,
          });
          if (!res.ok) throw new Error(`Search failed: ${res.status}`);
          const text = await res.text();
          const results = text.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          return ok({ count: results.length, results: results.slice(0, params.maxResults || 100) });
        }
        case "list_indexes": {
          const data = await this._fetch("/services/data/indexes?output_mode=json&count=50");
          return ok(data.entry?.map(e => ({ name: e.name, totalSize: e.content?.totalEventCount, currentDBSizeMB: e.content?.currentDBSizeMB })) || []);
        }
        case "get_alerts": {
          const data = await this._fetch(`/services/alerts/fired_alerts?output_mode=json&count=${params.count || 20}`);
          return ok(data.entry?.map(e => ({ name: e.name, severity: e.content?.severity, triggered: e.content?.triggered_alert_count })) || []);
        }
        case "list_saved_searches": {
          const data = await this._fetch("/services/saved/searches?output_mode=json&count=30");
          return ok(data.entry?.map(e => ({ name: e.name, search: e.content?.search, schedule: e.content?.cron_schedule, disabled: e.content?.disabled })) || []);
        }
        case "get_health": {
          const data = await this._fetch("/services/server/health/splunkd?output_mode=json");
          return ok(data.entry?.[0]?.content || { status: "unknown" });
        }
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e.message); }
  }
}
