/**
 * PostgreSQL Adapter
 */

import { Client as PgClient } from "pg";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class PostgreSQLAdapter extends BaseAdapter {
  _makeClientConfig() {
    return {
      host: this.config.host,
      port: parseInt(this.config.port || "5432"),
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10000,
    };
  }

  async _query(sql, params = []) {
    const client = new PgClient(this._makeClientConfig());
    await client.connect();
    try {
      return await client.query(sql, params);
    } finally {
      await client.end();
    }
  }

  async testConnection() {
    try {
      const res = await this._query("SELECT 1 as test");
      return { ok: true, message: `Connected to ${this.config.host}/${this.config.database}` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__query`,
        description: `Run a read-only SQL query on PostgreSQL (${this.connection.name})`,
        schema: {
          sql: z.string().describe("SQL query to execute (SELECT only)"),
          limit: z.number().optional().default(100).describe("Max rows to return"),
        },
      },
      {
        name: `${prefix}__schema`,
        description: `Get table schema from PostgreSQL (${this.connection.name})`,
        schema: {
          table: z.string().optional().describe("Table name. Omit to list all tables."),
          schema: z.string().optional().default("public").describe("Schema name"),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    switch (action) {
      case "query": return this._execQuery(params);
      case "schema": return this._execSchema(params);
      default: return err(`Unknown tool: ${toolName}`);
    }
  }

  async _execQuery({ sql, limit = 100 }) {
    const normalised = sql.trim().toLowerCase();
    if (!normalised.startsWith("select") && !normalised.startsWith("with") && !normalised.startsWith("explain")) {
      return err("Only SELECT / WITH / EXPLAIN queries are allowed.");
    }
    const safeSql = normalised.includes("limit") ? sql : `${sql} LIMIT ${limit}`;
    try {
      const res = await this._query(safeSql);
      return ok({ rowCount: res.rowCount, rows: res.rows, fields: res.fields.map(f => f.name) });
    } catch (e) {
      return err(e.message);
    }
  }

  async _execSchema({ table, schema = "public" }) {
    try {
      if (!table) {
        const res = await this._query(
          "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
          [schema]
        );
        return ok(res.rows);
      }
      const cols = await this._query(
        "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
        [schema, table]
      );
      const idxRes = await this._query(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=$2",
        [schema, table]
      );
      const countRes = await this._query(`SELECT COUNT(*) FROM "${schema}"."${table}"`);
      return ok({ table, columns: cols.rows, indexes: idxRes.rows, rowCount: countRes.rows[0].count });
    } catch (e) {
      return err(e.message);
    }
  }
}
