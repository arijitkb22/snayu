/**
 * GitHub Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class GitHubAdapter extends BaseAdapter {
  _headers() {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "snayu",
    };
  }

  _baseUrl() {
    return this.config.baseUrl || "https://api.github.com";
  }

  async _fetch(path, opts = {}) {
    const url = `${this._baseUrl()}${path}`;
    const res = await fetch(url, { headers: this._headers(), ...opts });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async testConnection() {
    try {
      const user = await this._fetch("/user");
      return { ok: true, message: `Connected as ${user.login}` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__list_repos`,
        description: `List GitHub repositories (${this.connection.name})`,
        schema: {
          org: z.string().optional().describe("Organization name. Omit for user repos."),
          limit: z.number().optional().default(30),
        },
      },
      {
        name: `${prefix}__search_issues`,
        description: `Search GitHub issues and PRs (${this.connection.name})`,
        schema: {
          query: z.string().describe("Search query, e.g. 'repo:owner/name is:issue is:open label:bug'"),
          limit: z.number().optional().default(20),
        },
      },
      {
        name: `${prefix}__get_file`,
        description: `Get a file's content from a GitHub repository (${this.connection.name})`,
        schema: {
          owner: z.string().describe("Repo owner"),
          repo: z.string().describe("Repo name"),
          path: z.string().describe("File path in repo"),
          ref: z.string().optional().describe("Branch/tag/commit"),
        },
      },
      {
        name: `${prefix}__list_prs`,
        description: `List pull requests (${this.connection.name})`,
        schema: {
          owner: z.string().describe("Repo owner"),
          repo: z.string().describe("Repo name"),
          state: z.string().optional().default("open").describe("open, closed, all"),
          limit: z.number().optional().default(20),
        },
      },
      {
        name: `${prefix}__get_pr_detail`,
        description: `Get full PR details including body, labels, reviewers, mergeable state, additions/deletions count (${this.connection.name})`,
        schema: {
          owner: z.string().describe("Repo owner"),
          repo: z.string().describe("Repo name"),
          pull_number: z.number().describe("PR number"),
        },
      },
      {
        name: `${prefix}__get_pr_diff`,
        description: `Get the full diff/patch for a pull request. Essential for code review — shows exactly what changed. (${this.connection.name})`,
        schema: {
          owner: z.string().describe("Repo owner"),
          repo: z.string().describe("Repo name"),
          pull_number: z.number().describe("PR number"),
          maxChars: z.number().optional().default(50000).describe("Max characters to return"),
        },
      },
      {
        name: `${prefix}__get_pr_files`,
        description: `List files changed in a PR with per-file additions, deletions, status (added/modified/removed), and patch. (${this.connection.name})`,
        schema: {
          owner: z.string().describe("Repo owner"),
          repo: z.string().describe("Repo name"),
          pull_number: z.number().describe("PR number"),
        },
      },
      {
        name: `${prefix}__get_pr_reviews`,
        description: `Get review comments and review decisions on a PR. Shows who reviewed, their verdict (APPROVED/CHANGES_REQUESTED/COMMENTED), and their comments. (${this.connection.name})`,
        schema: {
          owner: z.string().describe("Repo owner"),
          repo: z.string().describe("Repo name"),
          pull_number: z.number().describe("PR number"),
        },
      },
      {
        name: `${prefix}__get_pr_comments`,
        description: `Get inline code review comments on a PR — line-level feedback from reviewers. (${this.connection.name})`,
        schema: {
          owner: z.string().describe("Repo owner"),
          repo: z.string().describe("Repo name"),
          pull_number: z.number().describe("PR number"),
        },
      },
      {
        name: `${prefix}__create_pr_review`,
        description: `Submit a review on a PR — can approve, request changes, or comment. Supports inline line-level comments. (${this.connection.name})`,
        schema: {
          owner: z.string().describe("Repo owner"),
          repo: z.string().describe("Repo name"),
          pull_number: z.number().describe("PR number"),
          body: z.string().describe("Review summary text"),
          event: z.string().describe("APPROVE, REQUEST_CHANGES, or COMMENT"),
          comments: z.array(z.object({
            path: z.string().describe("File path"),
            position: z.number().optional().describe("Diff position (line in diff)"),
            body: z.string().describe("Comment text"),
          })).optional().describe("Inline comments on specific lines"),
        },
      },
      {
        name: `${prefix}__create_or_update_file`,
        description: `Create or update a file in a GitHub repo. Use for pushing review guides, config files, documentation. (${this.connection.name})`,
        schema: {
          owner: z.string().describe("Repo owner"),
          repo: z.string().describe("Repo name"),
          path: z.string().describe("File path in repo"),
          content: z.string().describe("File content (will be base64-encoded automatically)"),
          message: z.string().describe("Commit message"),
          branch: z.string().optional().describe("Branch name (defaults to repo default branch)"),
          sha: z.string().optional().describe("SHA of existing file (required for updates, omit for create)"),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "list_repos": {
          const path = params.org ? `/orgs/${params.org}/repos` : "/user/repos";
          const repos = await this._fetch(`${path}?per_page=${params.limit || 30}&sort=updated`);
          return ok(repos.map(r => ({ name: r.full_name, description: r.description, language: r.language, stars: r.stargazers_count, updated: r.updated_at })));
        }
        case "search_issues": {
          const data = await this._fetch(`/search/issues?q=${encodeURIComponent(params.query)}&per_page=${params.limit || 20}`);
          return ok({ total: data.total_count, items: data.items.map(i => ({ title: i.title, number: i.number, state: i.state, url: i.html_url, labels: i.labels.map(l => l.name), created: i.created_at })) });
        }
        case "get_file": {
          const ref = params.ref ? `?ref=${params.ref}` : "";
          const data = await this._fetch(`/repos/${params.owner}/${params.repo}/contents/${params.path}${ref}`);
          const content = data.content ? Buffer.from(data.content, "base64").toString("utf-8") : null;
          return ok({ path: data.path, size: data.size, content });
        }
        case "list_prs": {
          const prs = await this._fetch(`/repos/${params.owner}/${params.repo}/pulls?state=${params.state || "open"}&per_page=${params.limit || 20}`);
          return ok(prs.map(p => ({ title: p.title, number: p.number, state: p.state, url: p.html_url, author: p.user.login, created: p.created_at, labels: p.labels?.map(l => l.name), draft: p.draft, additions: p.additions, deletions: p.deletions })));
        }
        case "get_pr_detail": {
          const pr = await this._fetch(`/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}`);
          return ok({
            title: pr.title, number: pr.number, state: pr.state, url: pr.html_url,
            author: pr.user.login, body: pr.body, created: pr.created_at, updated: pr.updated_at,
            labels: pr.labels?.map(l => l.name), draft: pr.draft,
            additions: pr.additions, deletions: pr.deletions, changed_files: pr.changed_files,
            mergeable: pr.mergeable, mergeable_state: pr.mergeable_state,
            head: { ref: pr.head.ref, sha: pr.head.sha },
            base: { ref: pr.base.ref, sha: pr.base.sha },
            requested_reviewers: pr.requested_reviewers?.map(r => r.login),
          });
        }
        case "get_pr_diff": {
          const url = `${this._baseUrl()}/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}`;
          const res = await fetch(url, {
            headers: { ...this._headers(), Accept: "application/vnd.github.v3.diff" },
          });
          if (!res.ok) throw new Error(`GitHub API ${res.status}`);
          let diff = await res.text();
          const maxChars = params.maxChars || 50000;
          if (diff.length > maxChars) diff = diff.substring(0, maxChars) + "\n\n... (truncated)";
          return ok({ diff, length: diff.length });
        }
        case "get_pr_files": {
          const files = await this._fetch(`/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/files`);
          return ok(files.map(f => ({
            filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions,
            changes: f.changes, patch: f.patch?.substring(0, 5000),
          })));
        }
        case "get_pr_reviews": {
          const reviews = await this._fetch(`/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/reviews`);
          return ok(reviews.map(r => ({
            id: r.id, user: r.user.login, state: r.state, body: r.body,
            submittedAt: r.submitted_at,
          })));
        }
        case "get_pr_comments": {
          const comments = await this._fetch(`/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/comments`);
          return ok(comments.map(c => ({
            id: c.id, user: c.user.login, body: c.body, path: c.path,
            position: c.position, line: c.line, side: c.side,
            createdAt: c.created_at,
          })));
        }
        case "create_pr_review": {
          const url = `${this._baseUrl()}/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/reviews`;
          const body = { body: params.body, event: params.event };
          if (params.comments) body.comments = params.comments;
          const res = await fetch(url, {
            method: "POST",
            headers: this._headers(),
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
          const review = await res.json();
          return ok({ id: review.id, state: review.state, url: review.html_url });
        }
        case "create_or_update_file": {
          const url = `${this._baseUrl()}/repos/${params.owner}/${params.repo}/contents/${params.path}`;
          const body = {
            message: params.message,
            content: Buffer.from(params.content).toString("base64"),
          };
          if (params.branch) body.branch = params.branch;
          if (params.sha) body.sha = params.sha;
          const res = await fetch(url, {
            method: "PUT",
            headers: this._headers(),
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
          const data = await res.json();
          return ok({ path: data.content.path, sha: data.content.sha, url: data.content.html_url });
        }
        default: return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
