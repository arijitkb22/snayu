# M365 Copilot Agent Bridge

Connects your **Microsoft 365 Copilot agent** to Snayu via the DirectLine API.

## How It Works

```
VS Code Copilot / Claude
        ↓
   Snayu MCP Server
        ↓
   This Bridge (HTTP REST)
        ↓
   Azure DirectLine API
        ↓
   Your M365 Copilot Agent
```

## Setup

### 1. Get your DirectLine secret

**Option A — Azure Bot Service:**
1. Azure Portal → your Bot resource → Channels → Direct Line
2. Copy the **Secret Key**

**Option B — Copilot Studio:**
1. Copilot Studio → your agent → Settings → Channels → Direct Line
2. Copy the **Secret Key**

### 2. Run the bridge

```bash
cd examples/m365-copilot-bridge
npm install
DIRECTLINE_SECRET=your_secret_here node index.js
```

You'll see:
```
✅ M365 Copilot Bridge running on http://localhost:4000
```

### 3. Onboard in Snayu

1. Open http://localhost:3456
2. Click **Agent Registry** → **+ Register Agent**
3. Fill in:
   - **Name**: My M365 Copilot Agent
   - **Endpoint**: `http://localhost:4000`
   - **Protocol**: HTTP / REST
   - **Health Endpoint**: `http://localhost:4000/health`
4. Add tools:
   - `ask_copilot` — Send any message to your M365 Copilot agent and get a reply
   - `copilot_task` — Send a structured task with optional context
5. Click **Onboard** ✅

### 4. Use from VS Code Copilot

Once onboarded, open Copilot Chat and ask:
> "Use my M365 Copilot agent to plan my sprint tasks"

It will call `ask_copilot` or `copilot_task` through Snayu automatically.

## Exposed Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `ask_copilot` | `message: string` | Send any free-form message to your agent |
| `copilot_task` | `task: string, context?: string` | Send a structured task request |
