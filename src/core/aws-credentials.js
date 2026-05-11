/**
 * AWS Credential Provider with Auto-Refresh
 * 
 * Supports two modes:
 * 1. "credentials-file" — Reads ~/.aws/credentials (from SSO/Anvil/STS sessions)
 *    and auto-refreshes at a configurable interval (default: every 55 minutes).
 * 2. "static-keys" — Uses provided accessKeyId + secretAccessKey + optional sessionToken.
 * 
 * For short-lived session-based credentials (Anvil, SSO, assume-role), use
 * "credentials-file" mode. The provider will re-read the file on every refresh
 * cycle, picking up new credentials automatically.
 */

import { fromIni } from "@aws-sdk/credential-providers";
import fs from "fs";
import path from "path";
import os from "os";

// ─── Credential cache ────────────────────────────────────────────────────────
// Keyed by "profile:region" to avoid redundant refreshes for same profile.
const credentialCache = new Map();
const refreshTimers = new Map();

/**
 * Parse ~/.aws/credentials file directly for a given profile.
 * This is the most reliable way to get fresh session credentials
 * since fromIni may cache internally.
 */
function parseCredentialsFile(profile = "default") {
  const credPath = path.join(os.homedir(), ".aws", "credentials");
  if (!fs.existsSync(credPath)) {
    throw new Error(`AWS credentials file not found at ${credPath}`);
  }

  const content = fs.readFileSync(credPath, "utf-8");
  const lines = content.split("\n");
  let inProfile = false;
  const creds = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Match [profile-name]
    if (line.startsWith("[")) {
      const name = line.replace(/^\[/, "").replace(/\]$/, "").trim();
      inProfile = name === profile;
      continue;
    }
    if (inProfile && line.includes("=")) {
      const eqIdx = line.indexOf("=");
      const key = line.substring(0, eqIdx).trim();
      const value = line.substring(eqIdx + 1).trim();
      creds[key] = value;
    }
  }

  if (!creds.aws_access_key_id) {
    throw new Error(`Profile [${profile}] not found or has no aws_access_key_id in ${credPath}`);
  }

  return {
    accessKeyId: creds.aws_access_key_id,
    secretAccessKey: creds.aws_secret_access_key,
    sessionToken: creds.aws_session_token || undefined,
    expiration: creds.aws_expiration || undefined,
  };
}

/**
 * Get credentials for a given config. Handles caching and auto-refresh.
 * 
 * @param {object} config - The connection config from the registry
 * @param {string} config.authMode - "credentials-file" or "static-keys"
 * @param {string} config.profile - AWS profile name (for credentials-file mode)
 * @param {string} config.region - AWS region
 * @param {number} config.refreshIntervalMins - Refresh interval in minutes
 * @param {string} config.accessKeyId - Static access key
 * @param {string} config.secretAccessKey - Static secret key
 * @param {string} config.sessionToken - Static session token
 * @returns {object} AWS credentials object
 */
export function getAwsCredentials(config) {
  const authMode = config.authMode || "credentials-file";

  if (authMode === "static-keys") {
    // Static credentials — use as-is
    const creds = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
    if (config.sessionToken) {
      creds.sessionToken = config.sessionToken;
    }
    return creds;
  }

  // credentials-file mode — read from ~/.aws/credentials
  const profile = config.profile || "default";
  const cacheKey = `file:${profile}`;

  // Return cached if fresh
  const cached = credentialCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.credentials;
  }

  // Read fresh credentials from file
  const creds = parseCredentialsFile(profile);
  const refreshMs = (parseInt(config.refreshIntervalMins) || 55) * 60 * 1000;

  // Cache them
  credentialCache.set(cacheKey, {
    credentials: creds,
    expiresAt: Date.now() + refreshMs,
    profile,
  });

  // Set up auto-refresh timer if not already running
  if (!refreshTimers.has(cacheKey)) {
    const timer = setInterval(() => {
      try {
        const freshCreds = parseCredentialsFile(profile);
        credentialCache.set(cacheKey, {
          credentials: freshCreds,
          expiresAt: Date.now() + refreshMs,
          profile,
        });
        console.error(`[aws-creds] ✅ Refreshed credentials for profile [${profile}]`);
      } catch (e) {
        console.error(`[aws-creds] ⚠️ Failed to refresh credentials for profile [${profile}]: ${e.message}`);
        // Keep the old credentials — they may still be valid
      }
    }, refreshMs);

    // Don't let the timer keep the process alive
    timer.unref?.();
    refreshTimers.set(cacheKey, timer);
    console.error(`[aws-creds] Auto-refresh every ${config.refreshIntervalMins || 55}min for profile [${profile}]`);
  }

  return creds;
}

/**
 * Build a credential provider function compatible with AWS SDK v3.
 * The SDK calls this function each time it needs credentials,
 * so we always return the freshest cached credentials.
 */
export function makeAwsCredentialProvider(config) {
  return () => {
    const creds = getAwsCredentials(config);
    return Promise.resolve(creds);
  };
}

/**
 * Stop all auto-refresh timers (for cleanup).
 */
export function stopAllRefreshTimers() {
  for (const [key, timer] of refreshTimers) {
    clearInterval(timer);
  }
  refreshTimers.clear();
  credentialCache.clear();
}

/**
 * Force a credential refresh for a specific profile.
 */
export function forceRefresh(profile = "default") {
  const cacheKey = `file:${profile}`;
  credentialCache.delete(cacheKey);
  console.error(`[aws-creds] Forced refresh for profile [${profile}]`);
}
