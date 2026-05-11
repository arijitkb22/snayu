/**
 * M365 Copilot Agent Bridge
 * 
 * Wraps Microsoft DirectLine API into a plain HTTP REST adapter
 * that Snayu can connect to via the Agent Registry.
 * 
 * Usage:
 *   DIRECTLINE_SECRET=your_secret node index.js
 * 
 * Then onboard http://localhost:4000 in Snayu Agent Registry.
 */

import express from "express";

const app = express();
app.use(express.json());

const DIRECTLINE_SECRET = process.env.DIRECTLINE_SECRET;
const PORT = process.env.PORT || 4000;
const DIRECTLINE_BASE = "https://directline.botframework.com/v3/directline";

if (!DIRECTLINE_SECRET) {
  console.error("❌ Missing DIRECTLINE_SECRET environment variable");
  process.exit(1);
}

// ─── Health check ─────────────────────────────────────────────────────────
app.get("/health", (_, res) => {
  res.json({ status: "ok", adapter: "m365-copilot-bridge" });
});

// ─── Helper: start a DirectLine conversation ───────────────────────────────
async function startConversation() {
  const res = await fetch(`${DIRECTLINE_BASE}/conversations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DIRECTLINE_SECRET}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`DirectLine start failed: ${res.status}`);
  return res.json(); // { conversationId, token, ... }
}

// ─── Helper: send a message and wait for reply ────────────────────────────
async function sendAndReceive(conversationId, token, text, timeoutMs = 20000) {
  // Send message
  await fetch(`${DIRECTLINE_BASE}/conversations/${conversationId}/activities`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "message",
      from: { id: "snayu-bridge" },
      text,
    }),
  });

  // Poll for reply
  const deadline = Date.now() + timeoutMs;
  let watermark = null;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    const pollUrl = watermark
      ? `${DIRECTLINE_BASE}/conversations/${conversationId}/activities?watermark=${watermark}`
      : `${DIRECTLINE_BASE}/conversations/${conversationId}/activities`;

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await pollRes.json();
    watermark = data.watermark;

    // Find bot replies (not from our user)
    const botReplies = (data.activities || []).filter(
      a => a.from?.id !== "snayu-bridge" && a.type === "message"
    );

    if (botReplies.length > 0) {
      return botReplies.map(a => a.text || a.speak || JSON.stringify(a.value)).join("\n");
    }
  }

  throw new Error("M365 Copilot agent timed out (20s)");
}

// ─── Tool: ask_copilot ────────────────────────────────────────────────────
// Generic tool — send any message to your M365 Copilot agent and get a reply
app.post("/tools/ask_copilot", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message is required" });

  try {
    const { conversationId, token } = await startConversation();
    const reply = await sendAndReceive(conversationId, token, message);
    res.json({ reply, conversationId });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ─── Tool: copilot_task ───────────────────────────────────────────────────
// Structured tool — send a task with context to your M365 Copilot agent
app.post("/tools/copilot_task", async (req, res) => {
  const { task, context } = req.body;
  if (!task) return res.status(400).json({ error: "task is required" });

  const message = context ? `Task: ${task}\nContext: ${context}` : `Task: ${task}`;

  try {
    const { conversationId, token } = await startConversation();
    const reply = await sendAndReceive(conversationId, token, message);
    res.json({ result: reply, task, conversationId });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ M365 Copilot Bridge running on http://localhost:${PORT}`);
  console.log(`\nNow onboard this in Snayu Agent Registry:`);
  console.log(`  Endpoint:  http://localhost:${PORT}`);
  console.log(`  Protocol:  HTTP / REST`);
  console.log(`  Tools:     ask_copilot, copilot_task\n`);
});
