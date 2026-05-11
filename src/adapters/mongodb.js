/**
 * MongoDB Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

let MongoClient;

async function getMongo() {
  if (!MongoClient) {
    try {
      const mod = await import("mongodb");
      MongoClient = mod.MongoClient;
    } catch {
      throw new Error("mongodb package is not installed. Run: npm install mongodb");
    }
  }
  return MongoClient;
}

export default class MongoDBAdapter extends BaseAdapter {
  async _withClient(fn) {
    const MC = await getMongo();
    const client = new MC(this.config.connectionString);
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.close();
    }
  }

  async testConnection() {
    try {
      await this._withClient(async (client) => {
        await client.db().admin().ping();
      });
      return { ok: true, message: "Connected to MongoDB" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__list_collections`,
        description: `List MongoDB collections (${this.connection.name})`,
        schema: {
          database: z.string().optional().describe("Database name. Omit to use default from connection string."),
        },
      },
      {
        name: `${prefix}__find`,
        description: `Query a MongoDB collection (${this.connection.name})`,
        schema: {
          database: z.string().optional(),
          collection: z.string().describe("Collection name"),
          filter: z.record(z.any()).optional().default({}).describe("Query filter, e.g. {status: 'active'}"),
          limit: z.number().optional().default(20),
          sort: z.record(z.any()).optional().describe("Sort object, e.g. {createdAt: -1}"),
        },
      },
      {
        name: `${prefix}__aggregate`,
        description: `Run an aggregation pipeline on MongoDB (${this.connection.name})`,
        schema: {
          database: z.string().optional(),
          collection: z.string().describe("Collection name"),
          pipeline: z.array(z.record(z.any())).describe("Aggregation pipeline stages"),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      return await this._withClient(async (client) => {
        const db = client.db(params.database || undefined);
        switch (action) {
          case "list_collections": {
            const cols = await db.listCollections().toArray();
            return ok(cols.map(c => ({ name: c.name, type: c.type })));
          }
          case "find": {
            const cursor = db.collection(params.collection).find(params.filter || {});
            if (params.sort) cursor.sort(params.sort);
            const docs = await cursor.limit(params.limit || 20).toArray();
            return ok({ count: docs.length, documents: docs });
          }
          case "aggregate": {
            const docs = await db.collection(params.collection).aggregate(params.pipeline).toArray();
            return ok({ count: docs.length, results: docs });
          }
          default: return err(`Unknown tool: ${toolName}`);
        }
      });
    } catch (e) {
      return err(e.message);
    }
  }
}
