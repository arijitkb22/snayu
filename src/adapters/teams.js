/**
 * Microsoft Teams Adapter (via Incoming Webhook)
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class TeamsAdapter extends BaseAdapter {
  async testConnection() {
    try {
      const res = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "@type": "MessageCard",
          summary: "Snayu Test",
          text: "✅ Snayu successfully connected to this Teams channel!",
        }),
      });
      if (res.ok) {
        return { ok: true, message: "Webhook is valid — test message sent to Teams channel" };
      }
      const body = await res.text();
      return { ok: false, message: `Webhook responded with HTTP ${res.status}: ${body}` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__send_message`,
        description: `Send a message to Microsoft Teams (${this.connection.name})`,
        schema: {
          text: z.string().describe("Message text to send"),
          title: z.string().optional().describe("Optional card title"),
          color: z.string().optional().describe("Theme color hex, e.g. '0076D7'"),
        },
      },
      {
        name: `${prefix}__send_card`,
        description: `Send a rich MessageCard to Microsoft Teams (${this.connection.name})`,
        schema: {
          summary: z.string().describe("Card summary"),
          title: z.string().optional(),
          text: z.string().describe("Card body text (supports markdown)"),
          sections: z.array(z.record(z.any())).optional().describe("Card sections array"),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "send_message": {
          const card = {
            "@type": "MessageCard",
            summary: params.title || "Message from Snayu",
            themeColor: params.color || "0076D7",
            text: params.text,
          };
          if (params.title) card.title = params.title;
          const res = await fetch(this.config.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(card),
          });
          return res.ok
            ? ok({ sent: true, status: res.status })
            : err(`Teams webhook failed: HTTP ${res.status}`);
        }
        case "send_card": {
          const card = {
            "@type": "MessageCard",
            summary: params.summary,
            title: params.title,
            text: params.text,
            sections: params.sections,
          };
          const res = await fetch(this.config.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(card),
          });
          return res.ok
            ? ok({ sent: true, status: res.status })
            : err(`Teams webhook failed: HTTP ${res.status}`);
        }
        default:
          return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
