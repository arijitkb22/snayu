/**
 * OpenAI Adapter — Use LLMs as tools within Snayu
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class OpenAIAdapter extends BaseAdapter {
  async _fetch(path, body) {
    const base = this.config.baseUrl || "https://api.openai.com/v1";
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.json()).error?.message || "Unknown error"}`);
    return res.json();
  }

  async testConnection() {
    try {
      const base = this.config.baseUrl || "https://api.openai.com/v1";
      const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${this.config.apiKey}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, message: "Connected to OpenAI API" };
    } catch (e) { return { ok: false, message: e.message }; }
  }

  getTools() {
    const p = this.connection.id;
    return [
      { name: `${p}__chat`, description: `Send a chat completion request to OpenAI (${this.connection.name})`, schema: {
        prompt: z.string().describe("User message"), system: z.string().optional().describe("System prompt"),
        model: z.string().optional().default("gpt-4o"), temperature: z.number().optional().default(0.7), max_tokens: z.number().optional().default(2048),
      }},
      { name: `${p}__embedding`, description: `Generate text embeddings (${this.connection.name})`, schema: {
        text: z.string().describe("Text to embed"), model: z.string().optional().default("text-embedding-3-small"),
      }},
      { name: `${p}__summarize`, description: `Summarize text using OpenAI (${this.connection.name})`, schema: {
        text: z.string().describe("Text to summarize"), style: z.string().optional().default("concise").describe("concise, detailed, or bullet-points"),
      }},
      { name: `${p}__analyze`, description: `Analyze data or text and extract insights (${this.connection.name})`, schema: {
        data: z.string().describe("Data or text to analyze"), question: z.string().describe("What to analyze or extract"),
      }},
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "chat": {
          const messages = [];
          if (params.system) messages.push({ role: "system", content: params.system });
          messages.push({ role: "user", content: params.prompt });
          const data = await this._fetch("/chat/completions", { model: params.model || "gpt-4o", messages, temperature: params.temperature ?? 0.7, max_tokens: params.max_tokens || 2048 });
          return ok({ response: data.choices[0].message.content, usage: data.usage });
        }
        case "embedding": {
          const data = await this._fetch("/embeddings", { model: params.model || "text-embedding-3-small", input: params.text });
          return ok({ dimensions: data.data[0].embedding.length, embedding: data.data[0].embedding.slice(0, 5).concat(["..."]), usage: data.usage });
        }
        case "summarize": {
          const sys = { concise: "Summarize in 2-3 sentences.", detailed: "Provide a detailed summary with key points.", "bullet-points": "Summarize as bullet points." };
          const data = await this._fetch("/chat/completions", { model: "gpt-4o-mini", messages: [{ role: "system", content: sys[params.style] || sys.concise }, { role: "user", content: params.text }], max_tokens: 1024 });
          return ok({ summary: data.choices[0].message.content, usage: data.usage });
        }
        case "analyze": {
          const data = await this._fetch("/chat/completions", { model: "gpt-4o", messages: [
            { role: "system", content: "You are a data analysis expert. Provide clear, structured insights." },
            { role: "user", content: `Question: ${params.question}\n\nData:\n${params.data}` }
          ], max_tokens: 2048 });
          return ok({ analysis: data.choices[0].message.content, usage: data.usage });
        }
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e.message); }
  }
}
