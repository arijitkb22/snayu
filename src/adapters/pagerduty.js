/**
 * PagerDuty Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class PagerDutyAdapter extends BaseAdapter {
  async _fetch(path) {
    const url = `https://api.pagerduty.com${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Token token=${this.config.apiToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`PagerDuty API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async testConnection() {
    try {
      const data = await this._fetch("/users?limit=1");
      return { ok: true, message: "Connected to PagerDuty" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__list_incidents`,
        description: `List PagerDuty incidents (${this.connection.name})`,
        schema: {
          status: z.string().optional().default("triggered,acknowledged").describe("Comma-separated: triggered,acknowledged,resolved"),
          limit: z.number().optional().default(20),
        },
      },
      {
        name: `${prefix}__get_incident`,
        description: `Get PagerDuty incident details (${this.connection.name})`,
        schema: {
          incidentId: z.string().describe("Incident ID"),
        },
      },
      {
        name: `${prefix}__list_services`,
        description: `List PagerDuty services (${this.connection.name})`,
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
        case "list_incidents": {
          const statuses = (params.status || "triggered,acknowledged").split(",").map(s => `statuses[]=${s.trim()}`).join("&");
          const data = await this._fetch(`/incidents?${statuses}&limit=${params.limit || 20}&sort_by=created_at:desc`);
          return ok(data.incidents?.map(i => ({
            id: i.id, title: i.title, status: i.status, urgency: i.urgency,
            service: i.service?.summary, created: i.created_at,
          })));
        }
        case "get_incident": {
          const data = await this._fetch(`/incidents/${params.incidentId}`);
          const i = data.incident;
          return ok({
            id: i.id, title: i.title, status: i.status, urgency: i.urgency,
            description: i.description, service: i.service?.summary,
            assignees: i.assignments?.map(a => a.assignee?.summary),
            created: i.created_at, resolved: i.resolved_at,
          });
        }
        case "list_services": {
          const data = await this._fetch(`/services?limit=${params.limit || 25}`);
          return ok(data.services?.map(s => ({ id: s.id, name: s.name, status: s.status, description: s.description })));
        }
        default: return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
