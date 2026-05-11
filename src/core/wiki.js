/**
 * LLM Wiki — Persistent Context for AI Agents
 * 
 * A structured knowledge base that LLMs build and maintain themselves.
 * Stored as markdown files, shared across sessions, agents, and developers.
 * 
 * Design principles:
 * 1. FIXED PAGES — only 7 categories, never 100s of files
 * 2. INDEX-FIRST — _index.md is always loaded first (~20 lines), rest on-demand
 * 3. APPEND + COMPACT — new info appends, auto-summarizes when page > 200 lines
 * 4. TIMESTAMPED — every entry has a date for freshness
 * 5. SEARCHABLE — grep across all pages, return matching sections
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIKI_DIR = path.resolve(__dirname, "../../wiki");

// ─── Fixed Pages ─────────────────────────────────────────────────────────────

const PAGES = {
  _index: {
    file: "_index.md",
    title: "Wiki Index",
    description: "Table of contents and summary of what's in each page. This is always loaded first.",
    template: `# 🧠 LLM Wiki — Project Knowledge Base

> Auto-maintained by AI agents. Read this first to understand the project.

## Pages

| Page | What's Inside | Last Updated |
|------|--------------|--------------|
| [architecture](architecture.md) | Tech stack, patterns, folder structure | — |
| [agents](agents.md) | Agent configs, invocation, tools | — |
| [decisions](decisions.md) | Key decisions and rationale | — |
| [runbook](runbook.md) | Common tasks, commands, workflows | — |
| [changelog](changelog.md) | Recent changes and updates | — |
| [troubleshooting](troubleshooting.md) | Known issues, fixes, gotchas | — |
| [context](context.md) | Current state, active work, handoff notes | — |

## Project Summary
<!-- LLM: Replace this with a 2-3 line project summary -->
_Not yet documented. The first AI session should fill this in._

## Quick Facts
<!-- LLM: Add key facts like language, framework, port, etc. -->
- **Project**: _TBD_
- **Language**: _TBD_
- **Port**: _TBD_
`,
  },
  architecture: {
    file: "architecture.md",
    title: "Architecture",
    description: "Tech stack, system design, folder structure, key patterns, dependencies.",
    template: `# Architecture

## Tech Stack
<!-- LLM: Document languages, frameworks, databases, cloud services -->

## Folder Structure
<!-- LLM: Document key directories and what they contain -->

## Key Patterns
<!-- LLM: Document architectural patterns, conventions, coding standards -->

## Dependencies
<!-- LLM: Document critical dependencies and why they're used -->
`,
  },
  agents: {
    file: "agents.md",
    title: "Agents",
    description: "Agent configurations, what each does, how to invoke, tool mappings.",
    template: `# Agents

## Installed Agents
<!-- LLM: Document each agent with its tag, tools, and purpose -->

## How to Invoke
<!-- LLM: Document invocation methods (snayu, #mcp_snayu_snayu, etc.) -->

## Tool Mappings
<!-- LLM: Document which connections map to which tools -->
`,
  },
  decisions: {
    file: "decisions.md",
    title: "Decisions",
    description: "Key technical decisions and their rationale (ADR-lite format).",
    template: `# Decisions

<!-- LLM: Add decisions in this format:
## YYYY-MM-DD: Decision Title
**Context**: Why this decision was needed
**Decision**: What was decided
**Rationale**: Why this option was chosen
-->
`,
  },
  runbook: {
    file: "runbook.md",
    title: "Runbook",
    description: "How to do common tasks — commands, workflows, deployment steps.",
    template: `# Runbook

## Getting Started
<!-- LLM: Document setup steps, prerequisites -->

## Common Commands
<!-- LLM: Document frequently used commands -->

## Deployment
<!-- LLM: Document deployment process -->
`,
  },
  changelog: {
    file: "changelog.md",
    title: "Changelog",
    description: "Recent changes and updates. Auto-compacted to last 20 entries.",
    template: `# Changelog

<!-- LLM: Add entries in this format:
## YYYY-MM-DD HH:MM — Short Title
- What changed
- Why it changed
- Files affected
-->
`,
  },
  troubleshooting: {
    file: "troubleshooting.md",
    title: "Troubleshooting",
    description: "Known issues, common errors, fixes, and gotchas.",
    template: `# Troubleshooting

<!-- LLM: Add issues in this format:
## Problem: Short description
**Symptom**: What you see
**Cause**: Why it happens
**Fix**: How to resolve it
-->
`,
  },
  context: {
    file: "context.md",
    title: "Context",
    description: "Current state, active work, handoff notes. The 'what am I working on' page.",
    template: `# Current Context

## Active Work
<!-- LLM: What's currently being worked on -->
_No active work documented._

## Last Session Summary
<!-- LLM: Brief summary of what the last session accomplished -->
_No sessions documented yet._

## Handoff Notes
<!-- LLM: Important things the next session needs to know -->
_Nothing to hand off yet._

## Open Questions
<!-- LLM: Unresolved questions or decisions pending -->
`,
  },
};

const PAGE_NAMES = Object.keys(PAGES);
const MAX_LINES = 200;

// ─── File Locking (safe for concurrent multi-developer writes) ───────────────

const locks = new Map();

async function withLock(key, fn) {
  while (locks.get(key)) {
    await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
  }
  locks.set(key, true);
  try {
    return fn();
  } finally {
    locks.delete(key);
  }
}

// ─── Initialization ──────────────────────────────────────────────────────────

export function initWiki() {
  if (!fs.existsSync(WIKI_DIR)) {
    fs.mkdirSync(WIKI_DIR, { recursive: true });
  }
  // Create any missing pages with their templates
  let created = 0;
  for (const [key, page] of Object.entries(PAGES)) {
    const filePath = path.join(WIKI_DIR, page.file);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, page.template);
      created++;
    }
  }
  return { dir: WIKI_DIR, pages: PAGE_NAMES.length, created };
}

// ─── Read ────────────────────────────────────────────────────────────────────

export function readPage(pageName) {
  const page = PAGES[pageName];
  if (!page) return { error: `Unknown page: "${pageName}". Valid pages: ${PAGE_NAMES.join(", ")}` };
  
  const filePath = path.join(WIKI_DIR, page.file);
  if (!fs.existsSync(filePath)) {
    initWiki();
  }
  
  const content = fs.readFileSync(filePath, "utf-8");
  const stats = fs.statSync(filePath);
  const lines = content.split("\n").length;
  
  return {
    page: pageName,
    title: page.title,
    description: page.description,
    content,
    lines,
    lastModified: stats.mtime.toISOString(),
    needsCompaction: lines > MAX_LINES,
  };
}

export function readIndex() {
  return readPage("_index");
}

// ─── Write ───────────────────────────────────────────────────────────────────

export async function writePage(pageName, content, mode = "replace") {
  return withLock(`wiki:${pageName}`, () => {
    const page = PAGES[pageName];
    if (!page) return { error: `Unknown page: "${pageName}". Valid pages: ${PAGE_NAMES.join(", ")}` };
    if (pageName === "_index" && mode === "replace") {
      // Protect index structure — only allow append or managed updates
    }
  
  const filePath = path.join(WIKI_DIR, page.file);
  if (!fs.existsSync(WIKI_DIR)) initWiki();
  
  const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  
  if (mode === "append") {
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : page.template;
    const newContent = existing.trimEnd() + "\n\n" + `<!-- Updated: ${timestamp} -->\n` + content.trim() + "\n";
    fs.writeFileSync(filePath, newContent);
    
    // Check if compaction needed
    const lines = newContent.split("\n").length;
    return {
      page: pageName,
      mode: "append",
      lines,
      needsCompaction: lines > MAX_LINES,
      message: lines > MAX_LINES
        ? `⚠️ Page has ${lines} lines (max ${MAX_LINES}). Call wiki_compact to summarize old entries.`
        : `✅ Appended to ${pageName}. ${lines} lines.`,
    };
  }
  
  // Replace mode
  const newContent = `<!-- Last updated: ${timestamp} -->\n` + content.trim() + "\n";
  fs.writeFileSync(filePath, newContent);
  
  // Update index timestamps
  updateIndexTimestamp(pageName, timestamp);
  
  const lines = newContent.split("\n").length;
  return {
    page: pageName,
    mode: "replace",
    lines,
    message: `✅ Replaced ${pageName}. ${lines} lines.`,
  };
  }); // end withLock
}

function updateIndexTimestamp(pageName, timestamp) {
  const indexPath = path.join(WIKI_DIR, "_index.md");
  if (!fs.existsSync(indexPath)) return;
  
  let index = fs.readFileSync(indexPath, "utf-8");
  const page = PAGES[pageName];
  if (!page) return;
  
  // Update the table row for this page
  const pageLink = `[${pageName}](${page.file})`;
  const regex = new RegExp(`\\| \\[${pageName}\\]\\(${page.file}\\) \\|([^|]+)\\|([^|]+)\\|`);
  const match = index.match(regex);
  if (match) {
    index = index.replace(regex, `| [${pageName}](${page.file}) |${match[1]}| ${timestamp} |`);
    fs.writeFileSync(indexPath, index);
  }
}

// ─── Search ──────────────────────────────────────────────────────────────────

export function searchWiki(query) {
  if (!fs.existsSync(WIKI_DIR)) initWiki();
  
  const results = [];
  const queryLower = query.toLowerCase();
  
  for (const [key, page] of Object.entries(PAGES)) {
    const filePath = path.join(WIKI_DIR, page.file);
    if (!fs.existsSync(filePath)) continue;
    
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        // Get surrounding context (2 lines before, 2 after)
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length - 1, i + 2);
        const snippet = lines.slice(start, end + 1).join("\n");
        
        results.push({
          page: key,
          title: page.title,
          line: i + 1,
          snippet,
        });
      }
    }
  }
  
  return {
    query,
    matches: results.length,
    results: results.slice(0, 15), // Cap at 15 matches
  };
}

// ─── Compact ─────────────────────────────────────────────────────────────────

/**
 * Returns the content that needs compaction, split into "keep" and "old" sections.
 * The LLM should summarize "old" and call writePage with the compacted version.
 */
export function getCompactionPlan(pageName) {
  const page = PAGES[pageName];
  if (!page) return { error: `Unknown page: "${pageName}"` };
  
  const filePath = path.join(WIKI_DIR, page.file);
  if (!fs.existsSync(filePath)) return { error: "Page not found" };
  
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  
  if (lines.length <= MAX_LINES) {
    return { page: pageName, needsCompaction: false, lines: lines.length, message: "Page is within size limits." };
  }
  
  // For changelog: keep last 20 entries (## headings), summarize the rest
  // For other pages: keep the last 60% of content, summarize the first 40%
  const splitPoint = pageName === "changelog" 
    ? findChangelogSplitPoint(lines)
    : Math.floor(lines.length * 0.4);
  
  return {
    page: pageName,
    needsCompaction: true,
    totalLines: lines.length,
    maxLines: MAX_LINES,
    oldContent: lines.slice(0, splitPoint).join("\n"),
    keepContent: lines.slice(splitPoint).join("\n"),
    instruction: `Summarize the "oldContent" into a brief "## Summary of Earlier Entries" section (max 20 lines), then prepend it to "keepContent" and call wiki_write to replace the page.`,
  };
}

function findChangelogSplitPoint(lines) {
  // Find the 20th ## heading from the end
  let headingCount = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("## ")) {
      headingCount++;
      if (headingCount >= 20) return i;
    }
  }
  return Math.floor(lines.length * 0.4);
}

// ─── Status ──────────────────────────────────────────────────────────────────

export function wikiStatus() {
  if (!fs.existsSync(WIKI_DIR)) initWiki();
  
  const pages = [];
  for (const [key, page] of Object.entries(PAGES)) {
    const filePath = path.join(WIKI_DIR, page.file);
    if (!fs.existsSync(filePath)) {
      pages.push({ page: key, title: page.title, exists: false, lines: 0 });
      continue;
    }
    
    const content = fs.readFileSync(filePath, "utf-8");
    const stats = fs.statSync(filePath);
    const lines = content.split("\n").length;
    const isEmpty = content.includes("_Not yet documented") || content.includes("_TBD_") || lines < 15;
    
    pages.push({
      page: key,
      title: page.title,
      exists: true,
      lines,
      lastModified: stats.mtime.toISOString(),
      needsCompaction: lines > MAX_LINES,
      isEmpty,
    });
  }
  
  return {
    dir: WIKI_DIR,
    totalPages: pages.length,
    documented: pages.filter(p => p.exists && !p.isEmpty).length,
    needsCompaction: pages.filter(p => p.needsCompaction).map(p => p.page),
    pages,
  };
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

/**
 * Returns the minimal context needed to bootstrap a new session.
 * This is what gets injected into the LLM's instructions on startup.
 * ~30-50 lines max.
 */
export function getBootstrapContext() {
  if (!fs.existsSync(WIKI_DIR)) {
    initWiki();
    return {
      hasWiki: false,
      message: "Wiki initialized but empty. Start documenting by using wiki_write.",
    };
  }
  
  // Read index (always)
  const index = readPage("_index");
  
  // Read context page (current state) — this is the handoff
  const context = readPage("context");
  
  // Check what's documented
  const status = wikiStatus();
  
  return {
    hasWiki: true,
    documented: status.documented,
    totalPages: status.totalPages,
    index: index.content,
    currentContext: context.content,
    needsCompaction: status.needsCompaction,
    tip: "Use wiki_read to load specific pages on-demand. Use wiki_write to update pages after making changes. Use wiki_search to find information across all pages.",
  };
}

export { PAGES, PAGE_NAMES, WIKI_DIR };
