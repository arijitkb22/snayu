/**
 * MySQL Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

// MySQL uses a dynamic import since the user may not have mysql2 installed
let mysql;

async function getMySQL() {
  if (!mysql) {
    try {
      mysql = await import("mysql2/promise");
    } catch {
      throw new Error("mysql2 package is not installed. Run: npm install mysql2");
    }
  }
  return mysql;
}

export default class MySQLAdapter extends BaseAdapter {
  async _query(sql, params = []) {
    const m = await getMySQL();
    const conn = await m.createConnection({
      host: this.config.host,
      port: parseInt(this.config.port || "3306"),
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      connectTimeout: 10000,
    });
    try {
      const [rows, fields] = await conn.execute(sql, params);
      return { rows, fields };
    } finally {
      await conn.end();
    }
  }

  async testConnection() {
    try {
      await this._query("SELECT 1 as test");
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
        description: `Run a read-only SQL query on MySQL (${this.connection.name})`,
        schema: {
          sql: z.string().describe("SQL query (SELECT only)"),
          limit: z.number().optional().default(100),
        },
      },
      {
        name: `${prefix}__schema`,
        description: `Get table schema from MySQL (${this.connection.name})`,
        schema: {
          table: z.string().optional().describe("Table name. Omit to list all tables."),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "query": {
          const normalised = params.sql.trim().toLowerCase();
          if (!normalised.startsWith("select") && !normalised.startsWith("with") && !normalised.startsWith("explain")) {
            return err("Only SELECT / WITH / EXPLAIN queries are allowed.");
          }
          const safeSql = normalised.includes("limit") ? params.sql : `${params.sql} LIMIT ${params.limit || 100}`;
          const { rows, fields } = await this._query(safeSql);
          return ok({ rowCount: rows.length, rows, fields: fields?.map(f => f.name) });
        }
        case "schema": {
          if (!params.table) {
            const { rows } = await this._query("SHOW TABLES");
            return ok(rows);
          }
          const { rows: cols } = await this._query("DESCRIBE ??", [params.table]);
          const { rows: indexes } = await this._query("SHOW INDEX FROM ??", [params.table]);
          const { rows: countRes } = await this._query(`SELECT COUNT(*) as count FROM ??`, [params.table]);
          return ok({ table: params.table, columns: cols, indexes, rowCount: countRes[0]?.count });
        }
        default: return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
