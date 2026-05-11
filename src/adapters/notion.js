/**
 * Notion Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class NotionAdapter extends BaseAdapter {
  async _fetch(path, opts = {}) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json", ...opts.headers },
    });
    if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.json()).message || "error"}`);
    return res.json();
  }

  async testConnection() {
    try { await this._fetch("/users/me"); return { ok: true, message: "Connected to Notion" }; }
    catch (e) { return { ok: false, message: e.message }; }
  }

  getTools() {
    const p = this.connection.id;
    return [
      { name: `${p}__search`, description: `Search Notion pages and databases (${this.connection.name})`, schema: { query: z.string(), limit: z.number().optional().default(10) } },
      { name: `${p}__get_page`, description: `Get a Notion page by ID (${this.connection.name})`, schema: { pageId: z.string() } },
      { name: `${p}__create_page`, description: `Create a new Notion page (${this.connection.name})`, schema: { parentId: z.string().describe("Parent page or database ID"), title: z.string(), content: z.string().optional() } },
      { name: `${p}__query_database`, description: `Query a Notion database (${this.connection.name})`, schema: { databaseId: z.string(), filter: z.string().optional().describe("JSON filter object") } },
      { name: `${p}__list_databases`, description: `List accessible Notion databases (${this.connection.name})`, schema: {} },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "search": {
          const data = await this._fetch("/search", { method: "POST", body: JSON.stringify({ query: params.query, page_size: params.limit || 10 }) });
          return ok(data.results.map(r => ({ id: r.id, type: r.object, title: r.properties?.title?.title?.[0]?.plain_text || r.properties?.Name?.title?.[0]?.plain_text || "Untitled", url: r.url })));
        }
        case "get_page": {
          const [page, blocks] = await Promise.all([this._fetch(`/pages/${params.pageId}`), this._fetch(`/blocks/${params.pageId}/children`)]);
          const text = blocks.results.map(b => b.paragraph?.rich_text?.map(t => t.plain_text).join("") || b.heading_1?.rich_text?.[0]?.plain_text || "").filter(Boolean).join("\n");
          return ok({ id: page.id, url: page.url, content: text });
        }
        case "create_page": {
          const body = { parent: { page_id: params.parentId }, properties: { title: { title: [{ text: { content: params.title } }] } }, children: [] };
          if (params.content) body.children.push({ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: params.content } }] } });
          const data = await this._fetch("/pages", { method: "POST", body: JSON.stringify(body) });
          return ok({ id: data.id, url: data.url });
        }
        case "query_database": {
          const body = { page_size: 20 };
          if (params.filter) try { body.filter = JSON.parse(params.filter); } catch (_) {}
          const data = await this._fetch(`/databases/${params.databaseId}/query`, { method: "POST", body: JSON.stringify(body) });
          return ok(data.results.map(r => ({ id: r.id, properties: Object.fromEntries(Object.entries(r.properties).map(([k, v]) => [k, v.title?.[0]?.plain_text || v.rich_text?.[0]?.plain_text || v.number || v.select?.name || v.date?.start || JSON.stringify(v)])) })));
        }
        case "list_databases": {
          const data = await this._fetch("/search", { method: "POST", body: JSON.stringify({ filter: { value: "database", property: "object" }, page_size: 20 }) });
          return ok(data.results.map(d => ({ id: d.id, title: d.title?.[0]?.plain_text || "Untitled", url: d.url })));
        }
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e.message); }
  }
}
