/**
 * GitLab Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class GitLabAdapter extends BaseAdapter {
  _headers() {
    return {
      "PRIVATE-TOKEN": this.config.token,
      "Content-Type": "application/json",
    };
  }

  _baseUrl() {
    return (this.config.baseUrl || "https://gitlab.com/api/v4").replace(/\/+$/, "");
  }

  async _fetch(path) {
    const url = `${this._baseUrl()}${path}`;
    const res = await fetch(url, { headers: this._headers() });
    if (!res.ok) throw new Error(`GitLab API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async testConnection() {
    try {
      const user = await this._fetch("/user");
      return { ok: true, message: `Connected as ${user.username}` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__list_projects`,
        description: `List GitLab projects (${this.connection.name})`,
        schema: {
          owned: z.boolean().optional().default(true),
          limit: z.number().optional().default(20),
        },
      },
      {
        name: `${prefix}__search_issues`,
        description: `Search GitLab issues (${this.connection.name})`,
        schema: {
          search: z.string().describe("Search query"),
          projectId: z.number().optional().describe("Project ID to scope search"),
          state: z.string().optional().default("opened"),
          limit: z.number().optional().default(20),
        },
      },
      {
        name: `${prefix}__list_merge_requests`,
        description: `List merge requests (${this.connection.name})`,
        schema: {
          projectId: z.number().describe("Project ID"),
          state: z.string().optional().default("opened"),
          limit: z.number().optional().default(20),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "list_projects": {
          const projects = await this._fetch(`/projects?owned=${params.owned !== false}&per_page=${params.limit || 20}&order_by=updated_at`);
          return ok(projects.map(p => ({ id: p.id, name: p.path_with_namespace, description: p.description, stars: p.star_count, updated: p.last_activity_at })));
        }
        case "search_issues": {
          const scope = params.projectId ? `/projects/${params.projectId}` : "";
          const issues = await this._fetch(`${scope}/issues?search=${encodeURIComponent(params.search)}&state=${params.state || "opened"}&per_page=${params.limit || 20}`);
          return ok(issues.map(i => ({ iid: i.iid, title: i.title, state: i.state, url: i.web_url, labels: i.labels, created: i.created_at })));
        }
        case "list_merge_requests": {
          const mrs = await this._fetch(`/projects/${params.projectId}/merge_requests?state=${params.state || "opened"}&per_page=${params.limit || 20}`);
          return ok(mrs.map(m => ({ iid: m.iid, title: m.title, state: m.state, url: m.web_url, author: m.author?.username, created: m.created_at })));
        }
        default: return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
