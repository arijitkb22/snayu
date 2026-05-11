/**
 * Slack Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class SlackAdapter extends BaseAdapter {
  async _fetch(method, body = {}) {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
    return data;
  }

  async testConnection() {
    try {
      const data = await this._fetch("auth.test");
      return { ok: true, message: `Connected to workspace: ${data.team}` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__list_channels`,
        description: `List Slack channels (${this.connection.name})`,
        schema: {
          limit: z.number().optional().default(100),
        },
      },
      {
        name: `${prefix}__search_messages`,
        description: `Search Slack messages (${this.connection.name})`,
        schema: {
          query: z.string().describe("Search query"),
          count: z.number().optional().default(20),
        },
      },
      {
        name: `${prefix}__send_message`,
        description: `Send a message to a Slack channel (${this.connection.name})`,
        schema: {
          channel: z.string().describe("Channel ID or name"),
          text: z.string().describe("Message text"),
        },
      },
      {
        name: `${prefix}__get_channel_history`,
        description: `Get recent messages from a Slack channel (${this.connection.name})`,
        schema: {
          channel: z.string().describe("Channel ID"),
          limit: z.number().optional().default(20),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "list_channels": {
          const data = await this._fetch("conversations.list", { limit: params.limit || 100, types: "public_channel,private_channel" });
          return ok(data.channels.map(c => ({ id: c.id, name: c.name, topic: c.topic?.value, members: c.num_members })));
        }
        case "search_messages": {
          const data = await this._fetch("search.messages", { query: params.query, count: params.count || 20 });
          return ok({ total: data.messages?.total, matches: data.messages?.matches?.map(m => ({ text: m.text, channel: m.channel?.name, user: m.username, ts: m.ts })) });
        }
        case "send_message": {
          const data = await this._fetch("chat.postMessage", { channel: params.channel, text: params.text });
          return ok({ sent: true, ts: data.ts, channel: data.channel });
        }
        case "get_channel_history": {
          const data = await this._fetch("conversations.history", { channel: params.channel, limit: params.limit || 20 });
          return ok(data.messages?.map(m => ({ text: m.text, user: m.user, ts: m.ts, type: m.type })));
        }
        default: return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
