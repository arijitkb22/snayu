/**
 * Generic REST API Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class RestApiAdapter extends BaseAdapter {
  _buildHeaders() {
    const headers = { "Content-Type": "application/json" };
    const authType = this.config.authType || "none";

    switch (authType) {
      case "bearer":
        headers.Authorization = `Bearer ${this.config.authToken}`;
        break;
      case "basic": {
        const creds = Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64");
        headers.Authorization = `Basic ${creds}`;
        break;
      }
      case "api-key":
        headers[this.config.headerName || "Authorization"] = this.config.authToken;
        break;
    }
    return headers;
  }

  async testConnection() {
    try {
      const res = await fetch(this.config.baseUrl, { method: "GET", headers: this._buildHeaders() });
      return { ok: res.ok, message: res.ok ? `Connected (HTTP ${res.status})` : `Failed (HTTP ${res.status})` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__request`,
        description: `Make an HTTP request to ${this.config.baseUrl} (${this.connection.name})`,
        schema: {
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
          path: z.string().describe("API path, e.g. /users or /api/v1/items"),
          body: z.record(z.any()).optional().describe("Request body for POST/PUT/PATCH"),
          queryParams: z.record(z.string()).optional().describe("Query parameters"),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    try {
      let url = `${this.config.baseUrl}${params.path}`;
      if (params.queryParams) {
        const qs = new URLSearchParams(params.queryParams).toString();
        url += `?${qs}`;
      }
      const opts = {
        method: params.method || "GET",
        headers: this._buildHeaders(),
      };
      if (params.body && ["POST", "PUT", "PATCH"].includes(opts.method)) {
        opts.body = JSON.stringify(params.body);
      }
      const res = await fetch(url, opts);
      const contentType = res.headers.get("content-type") || "";
      let data;
      if (contentType.includes("json")) {
        data = await res.json();
      } else {
        data = await res.text();
      }
      return ok({ status: res.status, data });
    } catch (e) {
      return err(e.message);
    }
  }
}
