/**
 * Snowflake Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class SnowflakeAdapter extends BaseAdapter {
  async _query(sql) {
    const url = `https://${this.config.account}.snowflakecomputing.com/api/v2/statements`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.token}`,
        "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
      },
      body: JSON.stringify({
        statement: sql,
        timeout: 60,
        database: this.config.database,
        schema: this.config.schema || "PUBLIC",
        warehouse: this.config.warehouse,
      }),
    });
    if (!res.ok) throw new Error(`Snowflake ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async testConnection() {
    try {
      await this._query("SELECT CURRENT_TIMESTAMP()");
      return { ok: true, message: `Connected to Snowflake (${this.config.account})` };
    } catch (e) { return { ok: false, message: e.message }; }
  }

  getTools() {
    const p = this.connection.id;
    return [
      { name: `${p}__query`, description: `Run a read-only SQL query on Snowflake (${this.connection.name})`, schema: { sql: z.string().describe("SQL query (SELECT only)"), limit: z.number().optional().default(100) } },
      { name: `${p}__list_tables`, description: `List tables in the Snowflake database (${this.connection.name})`, schema: { schema: z.string().optional().default("PUBLIC") } },
      { name: `${p}__describe_table`, description: `Get column info for a Snowflake table (${this.connection.name})`, schema: { table: z.string() } },
      { name: `${p}__list_databases`, description: `List all accessible Snowflake databases (${this.connection.name})`, schema: {} },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "query": {
          const sql = params.sql.trim().replace(/;$/, "");
          if (!/^\s*SELECT/i.test(sql)) return err("Only SELECT queries are allowed for safety");
          const data = await this._query(`${sql} LIMIT ${params.limit || 100}`);
          return ok({ rowCount: data.resultSetMetaData?.numRows, columns: data.resultSetMetaData?.rowType?.map(c => c.name), data: data.data?.slice(0, params.limit || 100) });
        }
        case "list_tables": { const data = await this._query(`SHOW TABLES IN SCHEMA ${params.schema || 'PUBLIC'}`); return ok(data.data); }
        case "describe_table": { const data = await this._query(`DESCRIBE TABLE ${params.table}`); return ok(data.data); }
        case "list_databases": { const data = await this._query("SHOW DATABASES"); return ok(data.data); }
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e.message); }
  }
}
