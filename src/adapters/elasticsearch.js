/**
 * Elasticsearch / OpenSearch Adapter
 */

import { Client as EsClient } from "@elastic/elasticsearch";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class ElasticsearchAdapter extends BaseAdapter {
  _makeClient() {
    const opts = { node: this.config.node || "http://localhost:9200" };
    if (this.config.username) {
      opts.auth = { username: this.config.username, password: this.config.password || "" };
    }
    return new EsClient(opts);
  }

  async testConnection() {
    try {
      const es = this._makeClient();
      await es.info();
      return { ok: true, message: `Connected to Elasticsearch at ${this.config.node}` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__search`,
        description: `Search Elasticsearch index (${this.connection.name})`,
        schema: {
          index: z.string().describe("Index name or pattern"),
          query: z.record(z.any()).describe("Elasticsearch query DSL"),
          size: z.number().optional().default(20),
          sort: z.array(z.record(z.any())).optional(),
          source: z.array(z.string()).optional(),
        },
      },
      {
        name: `${prefix}__get_indices`,
        description: `List Elasticsearch indices (${this.connection.name})`,
        schema: {
          pattern: z.string().optional().default("*"),
        },
      },
      {
        name: `${prefix}__get_mapping`,
        description: `Get field mappings for an index (${this.connection.name})`,
        schema: {
          index: z.string().describe("Index name"),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    const es = this._makeClient();
    try {
      switch (action) {
        case "search": {
          const body = { query: params.query, size: params.size || 20 };
          if (params.sort) body.sort = params.sort;
          if (params.source) body._source = params.source;
          const res = await es.search({ index: params.index, body });
          const hits = res.hits.hits.map(h => ({ id: h._id, score: h._score, ...h._source }));
          return ok({ total: res.hits.total?.value, hits });
        }
        case "get_indices": {
          const res = await es.cat.indices({ index: params.pattern || "*", format: "json", h: "index,health,status,docs.count,store.size" });
          return ok(res);
        }
        case "get_mapping": {
          const res = await es.indices.getMapping({ index: params.index });
          return ok(res);
        }
        default: return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
