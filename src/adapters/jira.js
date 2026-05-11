/**
 * Jira Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class JiraAdapter extends BaseAdapter {
  _headers() {
    const mode = this.config.authMode || "cloud-api-token";
    let authHeader;

    if (mode === "pat-bearer") {
      // Jira Data Center / Server — Personal Access Token
      authHeader = `Bearer ${this.config.apiToken}`;
    } else {
      // Atlassian Cloud — Basic auth with email:apiToken
      const auth = Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString("base64");
      authHeader = `Basic ${auth}`;
    }

    return {
      Authorization: authHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  async _fetch(path) {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const apiVersion = (this.config.authMode === "pat-bearer") ? "2" : "3";
    const url = `${base}/rest/api/${apiVersion}${path}`;
    const res = await fetch(url, { headers: this._headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Jira API ${res.status}: ${body}`);
    }
    return res.json();
  }

  async testConnection() {
    try {
      const data = await this._fetch("/myself");
      return { ok: true, message: `Connected as ${data.displayName}` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__search`,
        description: `Search Jira issues with JQL (${this.connection.name})`,
        schema: {
          jql: z.string().describe("JQL query, e.g. 'project = PROJ AND status = Open'"),
          maxResults: z.number().optional().default(20),
        },
      },
      {
        name: `${prefix}__get_issue`,
        description: `Get a Jira issue by key (${this.connection.name})`,
        schema: {
          issueKey: z.string().describe("Issue key, e.g. PROJ-123"),
        },
      },
      {
        name: `${prefix}__list_projects`,
        description: `List Jira projects (${this.connection.name})`,
        schema: {},
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "search": {
          const data = await this._fetch(`/search?jql=${encodeURIComponent(params.jql)}&maxResults=${params.maxResults || 20}`);
          return ok({
            total: data.total,
            issues: data.issues.map(i => ({
              key: i.key,
              summary: i.fields.summary,
              status: i.fields.status?.name,
              assignee: i.fields.assignee?.displayName,
              priority: i.fields.priority?.name,
              created: i.fields.created,
            })),
          });
        }
        case "get_issue": {
          const data = await this._fetch(`/issue/${params.issueKey}`);
          return ok({
            key: data.key,
            summary: data.fields.summary,
            description: data.fields.description,
            status: data.fields.status?.name,
            assignee: data.fields.assignee?.displayName,
            reporter: data.fields.reporter?.displayName,
            priority: data.fields.priority?.name,
            labels: data.fields.labels,
            created: data.fields.created,
            updated: data.fields.updated,
          });
        }
        case "list_projects": {
          const data = await this._fetch("/project");
          return ok(data.map(p => ({ key: p.key, name: p.name, projectType: p.projectTypeKey })));
        }
        default: return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
