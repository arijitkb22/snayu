/**
 * Repo Wiki — Per-Repository Knowledge Base
 * 
 * Each GitHub repo gets its own structured wiki that agents incrementally build.
 * The PR Review agent builds code-structure, risk-map, standards, and pr-reviews.
 * Other agents can add their own page types for their use cases.
 * 
 * Structure:
 *   wiki/repos/<owner>__<repo>/
 *     _index.md         — Repo summary, page list, last analysis date
 *     code-structure.md — Codebase map, key files, patterns, tech stack
 *     pr-reviews.md     — Accumulated insights from past PR reviews
 *     risk-map.md       — Risky/volatile systems, risk scores per area
 *     standards.md      — Coding standards learned from reviews + docs
 *     changelog.md      — Repo-specific tracked changes
 * 
 * Connected to global wiki via wiki/repos/_index.md
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIKI_DIR = path.resolve(__dirname, "../../wiki");
const REPOS_DIR = path.join(WIKI_DIR, "repos");
const MAX_LINES = 300; // Per-repo pages can be larger since they're scoped

// ─── Local Wiki Support ──────────────────────────────────────────────────────
// When a user works inside a repo, the wiki can be stored locally in .snayu/wiki/
// This allows the wiki to travel with the code and be committed to the repo.

const LOCAL_WIKI_DIR_NAME = ".snayu/wiki";

/**
 * Resolve the wiki directory for a repo. Checks (in order):
 * 1. Local path: <workspace>/.snayu/wiki/ (if workspace matches the repo)
 * 2. Central path: wiki/repos/<owner>__<repo>/
 * 
 * Set via SNAYU_WORKSPACE env var or detected from cwd.
 */
function resolveRepoWikiDir(owner, repo, key) {
  // Check if we're working in a local workspace that has a .snayu/wiki
  const workspace = process.env.SNAYU_WORKSPACE || process.cwd();
  const localWikiDir = path.join(workspace, LOCAL_WIKI_DIR_NAME);
  
  // If a local .snayu/wiki exists in the workspace, use it
  if (fs.existsSync(localWikiDir)) {
    return { dir: localWikiDir, isLocal: true };
  }
  
  // Fall back to centralized store
  return { dir: path.join(REPOS_DIR, key), isLocal: false };
}

/**
 * Initialize a local .snayu/wiki/ in a given workspace directory.
 * Call this to "localize" a repo wiki — stores it in the user's repo for portability.
 */
export function initLocalRepoWiki(workspacePath, repoRef) {
  const { owner, repo, key } = repoKey(repoRef);
  const localDir = path.join(workspacePath, LOCAL_WIKI_DIR_NAME);
  
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }
  
  // Create pages
  let created = 0;
  for (const [name, page] of Object.entries(REPO_PAGES)) {
    const filePath = path.join(localDir, page.file);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, page.template(owner, repo));
      created++;
    }
  }
  
  // Create .gitignore suggestion (don't ignore by default — let user decide)
  const readmePath = path.join(workspacePath, ".snayu", "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.mkdirSync(path.join(workspacePath, ".snayu"), { recursive: true });
    fs.writeFileSync(readmePath, `# .snayu — AI Agent Knowledge Base

This directory contains structured knowledge that AI agents build over time.
It compounds with every PR review, investigation, and analysis.

## Should I commit this?
**Yes!** Committing \`.snayu/\` means:
- New team members' AI agents instantly have repo context
- PR reviewers get historical risk maps and standards
- Knowledge survives across machines and sessions

## Structure
- \`wiki/\` — Structured knowledge pages (code-structure, standards, risk-map, etc.)

## Maintained by
- Snayu agents (PR Review, Defect Triage, Infrastructure Investigator)
`);
  }
  
  return { 
    created: true, 
    repo: `${owner}/${repo}`, 
    dir: localDir, 
    pages: REPO_PAGE_NAMES, 
    newPages: created,
    message: `✅ Created local wiki at ${LOCAL_WIKI_DIR_NAME}/ (${created} pages). Commit .snayu/ to share with your team.`
  };
}

// ─── Repo Page Definitions ──────────────────────────────────────────────────

const REPO_PAGES = {
  _index: {
    file: "_index.md",
    title: "Repo Index",
    description: "Repository overview — tech stack, key facts, links to all pages.",
    template: (owner, repo) => `# 📦 ${owner}/${repo} — Repository Knowledge Base

> Auto-maintained by Snayu agents. Updated with every PR review.

## Quick Facts
- **Repo**: [${owner}/${repo}](https://github.com/${owner}/${repo})
- **Language**: _TBD_
- **Framework**: _TBD_
- **Last Analyzed**: _Never_

## Pages

| Page | What's Inside | Last Updated |
|------|--------------|--------------|
| [code-structure](code-structure.md) | Codebase map, key files, tech stack | — |
| [pr-reviews](pr-reviews.md) | Insights from past PR reviews | — |
| [risk-map](risk-map.md) | Risky/volatile areas, risk scores | — |
| [standards](standards.md) | Coding conventions and standards | — |
| [changelog](changelog.md) | Notable changes tracked over time | — |

## Repo Summary
<!-- Agent: Fill in a 2-3 line summary of what this repo does -->
_Not yet analyzed._
`,
  },
  "code-structure": {
    file: "code-structure.md",
    title: "Code Structure",
    description: "Codebase map — folder layout, key files, tech stack, dependencies, patterns.",
    template: (owner, repo) => `# 🗂️ Code Structure — ${owner}/${repo}

## Tech Stack
<!-- Agent: Document languages, frameworks, databases, infra -->

## Folder Layout
<!-- Agent: Key directories and what they contain -->

## Key Files
<!-- Agent: Critical files that reviewers should always check -->

## Patterns & Conventions
<!-- Agent: Coding patterns used — error handling, naming, architecture -->

## Dependencies
<!-- Agent: Critical dependencies and their purpose -->
`,
  },
  "pr-reviews": {
    file: "pr-reviews.md",
    title: "PR Reviews",
    description: "Accumulated insights from past PR reviews — recurring issues, patterns, learnings.",
    template: (owner, repo) => `# 📝 PR Review History — ${owner}/${repo}

## Review Summary
- **Total Reviews**: 0
- **Common Issues**: _None yet_
- **Average Risk Score**: _N/A_

## Recurring Patterns
<!-- Agent: Add patterns seen across multiple PRs -->

## Past Reviews
<!-- Agent: Append summary of each review:
### PR #<number> — <title> (YYYY-MM-DD)
- **Risk Score**: X/10
- **Key Findings**: ...
- **Author**: @<user>
- **Areas Touched**: ...
-->
`,
  },
  "risk-map": {
    file: "risk-map.md",
    title: "Risk Map",
    description: "Risky and volatile systems — areas that break often, need careful review.",
    template: (owner, repo) => `# ⚠️ Risk Map — ${owner}/${repo}

## High-Risk Areas
<!-- Agent: Add areas that are fragile, complex, or frequently cause issues -->
<!-- Format:
### <area/path>
- **Risk Level**: 🔴 HIGH / 🟡 MEDIUM / 🟢 LOW
- **Why**: Reason it's risky
- **Last Incident**: Date/description
- **Review Notes**: What to watch for
-->

## Volatile Files
<!-- Agent: Files that change frequently and often cause issues -->
<!-- Format:
| File | Change Frequency | Risk | Notes |
|------|-----------------|------|-------|
-->

## Risk Score Factors
<!-- Agent: Document repo-specific risk factors for PR scoring -->
- Touches auth/security → +3
- DB schema changes → +2
- Core business logic → +2
- Config/infra changes → +2
- UI-only changes → +0

## Known Fragile Systems
<!-- Agent: Systems that have caused production incidents -->
`,
  },
  standards: {
    file: "standards.md",
    title: "Standards",
    description: "Coding standards — learned from reviews, docs (CONTRIBUTING.md), and conventions.",
    template: (owner, repo) => `# 📏 Coding Standards — ${owner}/${repo}

## Source
<!-- Agent: Where these standards came from -->
- [ ] From CONTRIBUTING.md / coding-standards doc
- [ ] Learned from reference PRs
- [ ] Inferred from codebase patterns

## Naming Conventions
<!-- Agent: Variable, function, file, class naming rules -->

## Error Handling
<!-- Agent: How errors should be handled in this repo -->

## Testing Standards
<!-- Agent: Test structure, coverage expectations, patterns -->

## Code Organization
<!-- Agent: How code should be organized, imports, exports -->

## PR Requirements
<!-- Agent: What makes a good PR in this repo — size, description, tests -->

## Security Standards
<!-- Agent: Security-specific rules — auth, input validation, secrets -->
`,
  },
  changelog: {
    file: "changelog.md",
    title: "Changelog",
    description: "Notable changes tracked over time — significant PRs, architecture changes.",
    template: (owner, repo) => `# 📋 Changelog — ${owner}/${repo}

<!-- Agent: Append notable changes:
## YYYY-MM-DD — PR #<number>: <title>
- **Impact**: What changed
- **Risk**: X/10
- **Notes**: Anything the team should know
-->
`,
  },
};

const REPO_PAGE_NAMES = Object.keys(REPO_PAGES);

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a GitHub repo URL or "owner/repo" string to a safe directory key.
 * Supports: "owner/repo", "https://github.com/owner/repo", "github.com/owner/repo.git"
 */
export function repoKey(repoRef) {
  let cleaned = repoRef.trim()
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  
  // Now we should have "owner/repo" or "owner/repo/..."
  const parts = cleaned.split("/");
  if (parts.length < 2) throw new Error(`Invalid repo reference: "${repoRef}". Use "owner/repo" or a GitHub URL.`);
  
  const owner = parts[0];
  const repo = parts[1];
  const key = `${owner}__${repo}`;
  
  // Resolve directory — prefer local .snayu/wiki/ if it exists
  const { dir, isLocal } = resolveRepoWikiDir(owner, repo, key);
  
  return { owner, repo, key, dir, isLocal };
}

function ensureReposDir() {
  if (!fs.existsSync(REPOS_DIR)) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
  }
}

// ─── Initialize Repo Wiki ────────────────────────────────────────────────────

/**
 * Initialize a repo wiki. Creates all pages from templates.
 * Returns { created: true, pages: [...] } if new, or { exists: true } if already exists.
 */
export function initRepoWiki(repoRef, options = {}) {
  const { owner, repo, key, dir, isLocal } = repoKey(repoRef);
  
  // If user explicitly wants local mode
  if (options.local && options.workspacePath) {
    return initLocalRepoWiki(options.workspacePath, repoRef);
  }
  
  ensureReposDir();
  
  const existed = fs.existsSync(dir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  let created = 0;
  for (const [name, page] of Object.entries(REPO_PAGES)) {
    const filePath = path.join(dir, page.file);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, page.template(owner, repo));
      created++;
    }
  }
  
  // Update global repos index (only for central wikis)
  if (!isLocal) {
    updateReposIndex(owner, repo, key);
  }
  
  if (existed && created === 0) {
    return { exists: true, repo: `${owner}/${repo}`, key, dir, pages: REPO_PAGE_NAMES };
  }
  
  return { created: true, repo: `${owner}/${repo}`, key, dir, pages: REPO_PAGE_NAMES, newPages: created };
}

/**
 * Update the global repos/_index.md with this repo.
 */
function updateReposIndex(owner, repo, key) {
  ensureReposDir();
  const indexPath = path.join(REPOS_DIR, "_index.md");
  
  let content;
  if (!fs.existsSync(indexPath)) {
    content = `# 📚 Repository Knowledge Base Index

> All repos analyzed by Snayu agents.

| Repo | Key | Last Updated |
|------|-----|--------------|
`;
  } else {
    content = fs.readFileSync(indexPath, "utf-8");
  }
  
  // Check if repo already listed
  if (content.includes(`${owner}/${repo}`)) {
    // Update timestamp
    const regex = new RegExp(`\\| \\[${owner}/${repo}\\].*\\|.*\\|.*\\|`);
    const timestamp = new Date().toISOString().slice(0, 10);
    content = content.replace(regex, `| [${owner}/${repo}](${key}/_index.md) | ${key} | ${timestamp} |`);
  } else {
    const timestamp = new Date().toISOString().slice(0, 10);
    content = content.trimEnd() + `\n| [${owner}/${repo}](${key}/_index.md) | ${key} | ${timestamp} |\n`;
  }
  
  fs.writeFileSync(indexPath, content);
}

// ─── Read ────────────────────────────────────────────────────────────────────

export function readRepoPage(repoRef, pageName) {
  const { owner, repo, key, dir } = repoKey(repoRef);
  const page = REPO_PAGES[pageName];
  if (!page) return { error: `Unknown page: "${pageName}". Valid pages: ${REPO_PAGE_NAMES.join(", ")}` };
  
  const filePath = path.join(dir, page.file);
  if (!fs.existsSync(filePath)) {
    // Auto-init the wiki if it doesn't exist
    initRepoWiki(repoRef);
  }
  
  const content = fs.readFileSync(filePath, "utf-8");
  const stats = fs.statSync(filePath);
  const lines = content.split("\n").length;
  
  return {
    repo: `${owner}/${repo}`,
    page: pageName,
    title: page.title,
    description: page.description,
    content,
    lines,
    lastModified: stats.mtime.toISOString(),
    needsCompaction: lines > MAX_LINES,
  };
}

// ─── Write ───────────────────────────────────────────────────────────────────

export async function writeRepoPage(repoRef, pageName, content, mode = "replace") {
  const { owner, repo, key, dir, isLocal } = repoKey(repoRef);
  return withLock(`repo:${key}:${pageName}`, () => {
    const page = REPO_PAGES[pageName];
  if (!page) return { error: `Unknown page: "${pageName}". Valid pages: ${REPO_PAGE_NAMES.join(", ")}` };
  
  // Auto-init if needed
  if (!fs.existsSync(dir)) initRepoWiki(repoRef);
  
  const filePath = path.join(dir, page.file);
  const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  
  if (mode === "append") {
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : page.template(owner, repo);
    const newContent = existing.trimEnd() + "\n\n" + `<!-- Updated: ${timestamp} -->\n` + content.trim() + "\n";
    fs.writeFileSync(filePath, newContent);
    
    const lines = newContent.split("\n").length;
    // Update index timestamp
    updateRepoIndexTimestamp(dir, pageName, timestamp);
    if (!isLocal) updateReposIndex(owner, repo, key);
    
    return {
      repo: `${owner}/${repo}`, page: pageName, mode: "append", lines,
      needsCompaction: lines > MAX_LINES,
      message: lines > MAX_LINES
        ? `⚠️ Page has ${lines} lines (max ${MAX_LINES}). Consider compacting.`
        : `✅ Appended to ${pageName} in ${owner}/${repo}. ${lines} lines.`,
    };
  }
  
  // Replace mode
  const newContent = `<!-- Last updated: ${timestamp} -->\n` + content.trim() + "\n";
  fs.writeFileSync(filePath, newContent);
  updateRepoIndexTimestamp(dir, pageName, timestamp);
  if (!isLocal) updateReposIndex(owner, repo, key);
  
  const lines = newContent.split("\n").length;
  return {
    repo: `${owner}/${repo}`, page: pageName, mode: "replace", lines,
    message: `✅ Replaced ${pageName} in ${owner}/${repo}. ${lines} lines.`,
  };
  }); // end withLock
}

function updateRepoIndexTimestamp(dir, pageName, timestamp) {
  const indexPath = path.join(dir, "_index.md");
  if (!fs.existsSync(indexPath)) return;
  
  const page = REPO_PAGES[pageName];
  if (!page) return;
  
  let index = fs.readFileSync(indexPath, "utf-8");
  const regex = new RegExp(`\\| \\[${pageName}\\]\\(${page.file}\\) \\|([^|]+)\\|([^|]+)\\|`);
  const match = index.match(regex);
  if (match) {
    index = index.replace(regex, `| [${pageName}](${page.file}) |${match[1]}| ${timestamp} |`);
    fs.writeFileSync(indexPath, index);
  }
}

// ─── Search ──────────────────────────────────────────────────────────────────

export function searchRepoWiki(repoRef, query) {
  const { owner, repo, key, dir } = repoKey(repoRef);
  if (!fs.existsSync(dir)) return { error: `No wiki found for ${owner}/${repo}. Use repo_wiki_init first.` };
  
  const results = [];
  const queryLower = query.toLowerCase();
  
  for (const [name, page] of Object.entries(REPO_PAGES)) {
    const filePath = path.join(dir, page.file);
    if (!fs.existsSync(filePath)) continue;
    
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length - 1, i + 2);
        results.push({
          page: name, title: page.title, line: i + 1,
          snippet: lines.slice(start, end + 1).join("\n"),
        });
      }
    }
  }
  
  return { repo: `${owner}/${repo}`, query, matches: results.length, results: results.slice(0, 20) };
}

// ─── Status ──────────────────────────────────────────────────────────────────

export function repoWikiStatus(repoRef) {
  const { owner, repo, key, dir } = repoKey(repoRef);
  
  if (!fs.existsSync(dir)) {
    return { exists: false, repo: `${owner}/${repo}`, message: `No wiki for ${owner}/${repo}. Use repo_wiki_init to create one.` };
  }
  
  const pages = [];
  for (const [name, page] of Object.entries(REPO_PAGES)) {
    const filePath = path.join(dir, page.file);
    if (!fs.existsSync(filePath)) {
      pages.push({ page: name, title: page.title, exists: false, lines: 0 });
      continue;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const stats = fs.statSync(filePath);
    const lines = content.split("\n").length;
    const isEmpty = content.includes("_Not yet analyzed") || content.includes("_TBD_") || content.includes("_None yet_") || lines < 15;
    
    pages.push({
      page: name, title: page.title, exists: true, lines,
      lastModified: stats.mtime.toISOString(),
      needsCompaction: lines > MAX_LINES, isEmpty,
    });
  }
  
  return {
    exists: true, repo: `${owner}/${repo}`, key, dir,
    totalPages: pages.length,
    documented: pages.filter(p => p.exists && !p.isEmpty).length,
    needsCompaction: pages.filter(p => p.needsCompaction).map(p => p.page),
    pages,
  };
}

// ─── List All Repo Wikis ─────────────────────────────────────────────────────

export function listRepoWikis() {
  ensureReposDir();
  
  if (!fs.existsSync(REPOS_DIR)) return { repos: [] };
  
  const entries = fs.readdirSync(REPOS_DIR, { withFileTypes: true });
  const repos = [];
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parts = entry.name.split("__");
    if (parts.length !== 2) continue;
    
    const [owner, repo] = parts;
    const dir = path.join(REPOS_DIR, entry.name);
    const indexPath = path.join(dir, "_index.md");
    
    let lastModified = null;
    if (fs.existsSync(indexPath)) {
      lastModified = fs.statSync(indexPath).mtime.toISOString();
    }
    
    // Count documented pages
    let documented = 0;
    for (const [name, page] of Object.entries(REPO_PAGES)) {
      const fp = path.join(dir, page.file);
      if (fs.existsSync(fp)) {
        const content = fs.readFileSync(fp, "utf-8");
        const isEmpty = content.includes("_Not yet analyzed") || content.includes("_TBD_") || content.includes("_None yet_");
        if (!isEmpty) documented++;
      }
    }
    
    repos.push({ repo: `${owner}/${repo}`, key: entry.name, documented, totalPages: REPO_PAGE_NAMES.length, lastModified });
  }
  
  return { repos, total: repos.length };
}

// ─── Bootstrap for PR Review ─────────────────────────────────────────────────

/**
 * Get all existing knowledge for a repo — used by PR Review agent to
 * load context before reviewing. Returns condensed version of all pages.
 */
export function getRepoContext(repoRef) {
  const { owner, repo, key, dir } = repoKey(repoRef);
  
  if (!fs.existsSync(dir)) {
    return {
      exists: false,
      repo: `${owner}/${repo}`,
      message: "No existing knowledge. Will analyze and create wiki during this review.",
    };
  }
  
  const context = {};
  for (const [name, page] of Object.entries(REPO_PAGES)) {
    if (name === "_index") continue; // Skip index, we have it implicitly
    const filePath = path.join(dir, page.file);
    if (!fs.existsSync(filePath)) continue;
    
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").length;
    const isEmpty = content.includes("_Not yet analyzed") || content.includes("_TBD_") || content.includes("_None yet_") || lines < 15;
    
    if (!isEmpty) {
      // For large pages, include first 50 lines as summary
      const contentLines = content.split("\n");
      context[name] = {
        title: page.title,
        lines,
        content: lines > 60 ? contentLines.slice(0, 50).join("\n") + `\n\n... (${lines - 50} more lines — use repo_wiki_read for full content)` : content,
      };
    }
  }
  
  return {
    exists: true,
    repo: `${owner}/${repo}`,
    documented: Object.keys(context).length,
    totalPages: REPO_PAGE_NAMES.length - 1, // Exclude _index
    pages: context,
    tip: "Use repo_wiki_read for full page content. Update pages with repo_wiki_write after reviewing.",
  };
}

export { REPO_PAGES, REPO_PAGE_NAMES, REPOS_DIR };
