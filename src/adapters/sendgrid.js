/**
 * SendGrid Email Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class SendGridAdapter extends BaseAdapter {
  async _fetch(path, opts = {}) {
    const res = await fetch(`https://api.sendgrid.com/v3${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", ...opts.headers },
    });
    if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text()}`);
    return res.status === 204 ? {} : res.json();
  }

  async testConnection() {
    try {
      await this._fetch("/user/profile");
      return { ok: true, message: "Connected to SendGrid" };
    } catch (e) { return { ok: false, message: e.message }; }
  }

  getTools() {
    const p = this.connection.id;
    return [
      { name: `${p}__send_email`, description: `Send an email via SendGrid (${this.connection.name})`, schema: {
        to: z.string().describe("Recipient email"), subject: z.string(), body: z.string().describe("Plain text or HTML body"),
        from: z.string().optional().describe("Sender email (defaults to config)"),
      }},
      { name: `${p}__get_stats`, description: `Get email sending statistics (${this.connection.name})`, schema: { days: z.number().optional().default(7) } },
      { name: `${p}__list_templates`, description: `List SendGrid email templates (${this.connection.name})`, schema: {} },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "send_email": {
          await this._fetch("/mail/send", { method: "POST", body: JSON.stringify({
            personalizations: [{ to: [{ email: params.to }] }],
            from: { email: params.from || this.config.fromEmail || "noreply@example.com" },
            subject: params.subject,
            content: [{ type: params.body.includes("<") ? "text/html" : "text/plain", value: params.body }],
          })});
          return ok({ status: "sent", to: params.to, subject: params.subject });
        }
        case "get_stats": {
          const start = new Date(Date.now() - (params.days || 7) * 86400000).toISOString().split("T")[0];
          const data = await this._fetch(`/stats?start_date=${start}`);
          return ok(data);
        }
        case "list_templates": {
          const data = await this._fetch("/templates?generations=dynamic&page_size=20");
          return ok(data.templates?.map(t => ({ id: t.id, name: t.name, updated: t.updated_at })) || []);
        }
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e.message); }
  }
}
