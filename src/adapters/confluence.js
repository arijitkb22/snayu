/**
 * Confluence Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class ConfluenceAdapter extends BaseAdapter {
  _headers() {
    const auth = Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  async _fetch(path) {
    const url = `${this.config.baseUrl}/wiki/rest/api${path}`;
    const res = await fetch(url, { headers: this._headers() });
    if (!res.ok) throw new Error(`Confluence API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async testConnection() {
    try {
      await this._fetch("/space?limit=1");
      return { ok: true, message: `Connected to Confluence at ${this.config.baseUrl}` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__search`,
        description: `Search Confluence content (${this.connection.name})`,
        schema: {
          query: z.string().describe("CQL query or text search"),
          limit: z.number().optional().default(10),
        },
      },
      {
        name: `${prefix}__get_page`,
        description: `Get a Confluence page by ID (${this.connection.name})`,
        schema: {
          pageId: z.string().describe("Page ID"),
        },
      },
      {
        name: `${prefix}__list_spaces`,
        description: `List Confluence spaces (${this.connection.name})`,
        schema: {
          limit: z.number().optional().default(25),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "search": {
          const data = await this._fetch(`/content/search?cql=${encodeURIComponent(params.query)}&limit=${params.limit || 10}`);
          return ok({ total: data.size, results: data.results?.map(r => ({ id: r.id, title: r.title, type: r.type, url: r._links?.webui })) });
        }
        case "get_page": {
          const data = await this._fetch(`/content/${params.pageId}?expand=body.storage,version`);
          return ok({ id: data.id, title: data.title, version: data.version?.number, body: data.body?.storage?.value });
        }
        case "list_spaces": {
          const data = await this._fetch(`/space?limit=${params.limit || 25}`);
          return ok(data.results?.map(s => ({ key: s.key, name: s.name, type: s.type })));
        }
        default: return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
