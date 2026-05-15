/**
 * Databricks Adapter
 * 
 * Uses the Databricks REST API to query SQL warehouses,
 * list clusters, jobs, and workspace notebooks.
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class DatabricksAdapter extends BaseAdapter {
  _headers() {
    return {
      Authorization: `Bearer ${this.config.token}`,
      "Content-Type": "application/json",
    };
  }

  _url(path) {
    const host = this.config.host.replace(/\/+$/, "");
    return `${host}/api/2.0${path}`;
  }

  async _fetch(path, opts = {}) {
    const res = await fetch(this._url(path), { headers: this._headers(), ...opts });
    if (!res.ok) throw new Error(`Databricks API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async testConnection() {
    try {
      await this._fetch("/clusters/list");
      return { ok: true, message: "Connected to Databricks" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__sql_query`,
        description: `Execute a SQL query on a Databricks SQL warehouse. Returns results as JSON rows. (${this.connection.name})`,
        schema: {
          sql: z.string().describe("SQL statement to execute"),
          warehouseId: z.string().optional().describe("SQL warehouse ID (uses default from connection if omitted)"),
          limit: z.number().optional().default(100).describe("Max rows to return"),
        },
      },
      {
        name: `${prefix}__list_clusters`,
        description: `List all Databricks clusters with state, type, and Spark version (${this.connection.name})`,
        schema: {},
      },
      {
        name: `${prefix}__get_cluster`,
        description: `Get details of a specific Databricks cluster (${this.connection.name})`,
        schema: {
          clusterId: z.string().describe("Cluster ID"),
        },
      },
      {
        name: `${prefix}__list_jobs`,
        description: `List Databricks jobs with schedule and last run status (${this.connection.name})`,
        schema: {
          limit: z.number().optional().default(25),
          name: z.string().optional().describe("Filter jobs by name (contains)"),
        },
      },
      {
        name: `${prefix}__get_job_runs`,
        description: `List recent runs for a Databricks job (${this.connection.name})`,
        schema: {
          jobId: z.number().describe("Job ID"),
          limit: z.number().optional().default(10),
        },
      },
      {
        name: `${prefix}__list_workspace`,
        description: `List notebooks and folders in a Databricks workspace path (${this.connection.name})`,
        schema: {
          path: z.string().optional().default("/").describe("Workspace path, e.g. /Users/me or /Repos"),
        },
      },
    ];
  }

  async callTool(toolName, args) {
    const action = toolName.split("__").pop();

    try {
      switch (action) {
        case "sql_query": {
          const whId = args.warehouseId || this.config.warehouseId;
          if (!whId) return err("No SQL warehouse ID provided. Pass warehouseId or configure it in the connection.");
          const body = {
            warehouse_id: whId,
            statement: args.sql,
            wait_timeout: "30s",
            disposition: "INLINE",
            format: "JSON_ARRAY",
          };
          const res = await this._fetch("/sql/statements", {
            method: "POST",
            body: JSON.stringify(body),
          });
          if (res.status?.state === "FAILED") return err(res.status.error?.message || "Query failed");
          const columns = res.manifest?.schema?.columns?.map(c => c.name) || [];
          const rows = (res.result?.data_array || []).slice(0, args.limit || 100).map(row => {
            const obj = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return obj;
          });
          return ok({ columns, rowCount: rows.length, rows });
        }

        case "list_clusters": {
          const res = await this._fetch("/clusters/list");
          return ok((res.clusters || []).map(c => ({
            id: c.cluster_id, name: c.cluster_name, state: c.state,
            sparkVersion: c.spark_version, nodeType: c.node_type_id,
            numWorkers: c.num_workers, autoscale: c.autoscale,
            creator: c.creator_user_name,
          })));
        }

        case "get_cluster": {
          const res = await this._fetch(`/clusters/get?cluster_id=${encodeURIComponent(args.clusterId)}`);
          return ok({
            id: res.cluster_id, name: res.cluster_name, state: res.state,
            sparkVersion: res.spark_version, nodeType: res.node_type_id,
            driverNodeType: res.driver_node_type_id, numWorkers: res.num_workers,
            autoscale: res.autoscale, startTime: res.start_time,
            terminationReason: res.termination_reason, creator: res.creator_user_name,
          });
        }

        case "list_jobs": {
          const params = new URLSearchParams({ limit: String(args.limit || 25), expand_tasks: "false" });
          if (args.name) params.set("name", args.name);
          const res = await this._fetch(`/jobs/list?${params}`);
          return ok((res.jobs || []).map(j => ({
            id: j.job_id, name: j.settings?.name, schedule: j.settings?.schedule?.quartz_cron_expression,
            creator: j.creator_user_name, createdTime: j.created_time,
          })));
        }

        case "get_job_runs": {
          const params = new URLSearchParams({ job_id: String(args.jobId), limit: String(args.limit || 10) });
          const res = await this._fetch(`/jobs/runs/list?${params}`);
          return ok((res.runs || []).map(r => ({
            runId: r.run_id, state: r.state?.result_state || r.state?.life_cycle_state,
            startTime: r.start_time, endTime: r.end_time,
            duration: r.run_duration, trigger: r.trigger,
          })));
        }

        case "list_workspace": {
          const res = await this._fetch(`/workspace/list?path=${encodeURIComponent(args.path || "/")}`);
          return ok((res.objects || []).map(o => ({
            path: o.path, type: o.object_type, language: o.language,
          })));
        }

        default:
          return err(`Unknown action: ${action}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
