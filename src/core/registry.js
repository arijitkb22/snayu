/**
 * Service Registry — The heart of Snayu.
 * 
 * Stores all service definitions (what CAN be connected) and
 * connection configs (what IS connected). Persists to disk as JSON.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../../data");
const CONNECTIONS_FILE = path.join(DATA_DIR, "connections.json");

// ─── Ensure data directory ───────────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONNECTIONS_FILE)) fs.writeFileSync(CONNECTIONS_FILE, "{}");

// ─── Service Catalog ─────────────────────────────────────────────────────────
// Every service the connector knows about, with its required fields.
const SERVICE_CATALOG = {
  // ── Databases ──
  postgresql: {
    id: "postgresql",
    name: "PostgreSQL",
    category: "database",
    icon: "🐘",
    description: "Connect to PostgreSQL / Amazon RDS PostgreSQL databases",
    connectionType: "direct",
    fields: [
      { key: "host", label: "Host", type: "text", required: true, placeholder: "localhost or my-db.rds.amazonaws.com" },
      { key: "port", label: "Port", type: "number", required: true, default: 5432 },
      { key: "database", label: "Database", type: "text", required: true, placeholder: "mydb" },
      { key: "user", label: "Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true },
      { key: "ssl", label: "Use SSL", type: "boolean", required: false, default: false },
    ],
  },
  mysql: {
    id: "mysql",
    name: "MySQL",
    category: "database",
    icon: "🐬",
    description: "Connect to MySQL / Amazon RDS MySQL databases",
    connectionType: "direct",
    fields: [
      { key: "host", label: "Host", type: "text", required: true },
      { key: "port", label: "Port", type: "number", required: true, default: 3306 },
      { key: "database", label: "Database", type: "text", required: true },
      { key: "user", label: "Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true },
    ],
  },
  mongodb: {
    id: "mongodb",
    name: "MongoDB",
    category: "database",
    icon: "🍃",
    description: "Connect to MongoDB or MongoDB Atlas",
    connectionType: "direct",
    fields: [
      { key: "connectionString", label: "Connection String", type: "text", required: true, placeholder: "mongodb+srv://user:pass@cluster.mongodb.net/db" },
    ],
  },
  dynamodb: {
    id: "dynamodb",
    name: "DynamoDB",
    category: "database",
    icon: "⚡",
    description: "Connect to Amazon DynamoDB",
    connectionType: "aws",
    fields: [
      { key: "region", label: "AWS Region", type: "text", required: true, default: "ap-south-1" },
      { key: "authMode", label: "Auth Mode", type: "select", required: true, options: ["credentials-file", "static-keys"], default: "credentials-file" },
      { key: "profile", label: "AWS Profile (for credentials file)", type: "text", required: false, default: "default" },
      { key: "refreshIntervalMins", label: "Credential refresh interval (minutes)", type: "number", required: false, default: 55 },
      { key: "accessKeyId", label: "Access Key ID (for static keys)", type: "text", required: false, placeholder: "Only if using static keys" },
      { key: "secretAccessKey", label: "Secret Access Key (for static keys)", type: "password", required: false },
      { key: "sessionToken", label: "Session Token (for temporary credentials)", type: "password", required: false, placeholder: "From STS / SSO / Anvil" },
    ],
  },

  // ── Cloud Services ──
  aws_s3: {
    id: "aws_s3",
    name: "Amazon S3",
    category: "cloud",
    icon: "📦",
    description: "Connect to Amazon S3 buckets",
    connectionType: "aws",
    fields: [
      { key: "region", label: "AWS Region", type: "text", required: true, default: "ap-south-1" },
      { key: "authMode", label: "Auth Mode", type: "select", required: true, options: ["credentials-file", "static-keys"], default: "credentials-file" },
      { key: "profile", label: "AWS Profile (for credentials file)", type: "text", required: false, default: "default" },
      { key: "refreshIntervalMins", label: "Credential refresh interval (minutes)", type: "number", required: false, default: 55 },
      { key: "accessKeyId", label: "Access Key ID (for static keys)", type: "text", required: false },
      { key: "secretAccessKey", label: "Secret Access Key (for static keys)", type: "password", required: false },
      { key: "sessionToken", label: "Session Token (for temporary credentials)", type: "password", required: false },
    ],
  },
  aws_cloudwatch: {
    id: "aws_cloudwatch",
    name: "CloudWatch Logs",
    category: "cloud",
    icon: "📊",
    description: "Connect to Amazon CloudWatch Logs",
    connectionType: "aws",
    fields: [
      { key: "region", label: "AWS Region", type: "text", required: true, default: "ap-south-1" },
      { key: "authMode", label: "Auth Mode", type: "select", required: true, options: ["credentials-file", "static-keys"], default: "credentials-file" },
      { key: "profile", label: "AWS Profile (for credentials file)", type: "text", required: false, default: "default" },
      { key: "refreshIntervalMins", label: "Credential refresh interval (minutes)", type: "number", required: false, default: 55 },
      { key: "accessKeyId", label: "Access Key ID (for static keys)", type: "text", required: false },
      { key: "secretAccessKey", label: "Secret Access Key (for static keys)", type: "password", required: false },
      { key: "sessionToken", label: "Session Token (for temporary credentials)", type: "password", required: false },
    ],
  },

  // ── Search ──
  elasticsearch: {
    id: "elasticsearch",
    name: "Elasticsearch / OpenSearch",
    category: "search",
    icon: "🔍",
    description: "Connect to Elasticsearch or Amazon OpenSearch",
    connectionType: "direct",
    fields: [
      { key: "node", label: "Endpoint URL", type: "text", required: true, placeholder: "http://localhost:9200" },
      { key: "username", label: "Username", type: "text", required: false },
      { key: "password", label: "Password", type: "password", required: false },
    ],
  },

  // ── DevOps / Collaboration ──
  github: {
    id: "github",
    name: "GitHub",
    category: "devops",
    icon: "🐙",
    description: "Connect to GitHub repositories, issues, PRs",
    connectionType: "rest",
    fields: [
      { key: "token", label: "Personal Access Token", type: "password", required: true },
      { key: "baseUrl", label: "API Base URL", type: "text", required: false, default: "https://api.github.com", placeholder: "For GitHub Enterprise" },
    ],
  },
  gitlab: {
    id: "gitlab",
    name: "GitLab",
    category: "devops",
    icon: "🦊",
    description: "Connect to GitLab repositories, issues, merge requests",
    connectionType: "rest",
    fields: [
      { key: "token", label: "Personal Access Token", type: "password", required: true },
      { key: "baseUrl", label: "API Base URL", type: "text", required: true, default: "https://gitlab.com/api/v4" },
    ],
  },
  jira: {
    id: "jira",
    name: "Jira",
    category: "devops",
    icon: "📋",
    description: "Connect to Jira for issue tracking",
    connectionType: "rest",
    fields: [
      { key: "baseUrl", label: "Jira URL", type: "text", required: true, placeholder: "https://your-domain.atlassian.net" },
      { key: "authMode", label: "Auth Mode", type: "select", required: true, options: ["cloud-api-token", "pat-bearer"], default: "cloud-api-token" },
      { key: "email", label: "Email (Cloud only)", type: "text", required: false, placeholder: "you@company.com" },
      { key: "apiToken", label: "API Token / PAT", type: "password", required: true, placeholder: "Cloud API token or Data Center PAT" },
    ],
  },
  confluence: {
    id: "confluence",
    name: "Confluence",
    category: "devops",
    icon: "📖",
    description: "Connect to Confluence for documentation",
    connectionType: "rest",
    fields: [
      { key: "baseUrl", label: "Confluence URL", type: "text", required: true, placeholder: "https://your-domain.atlassian.net" },
      { key: "email", label: "Email", type: "text", required: true },
      { key: "apiToken", label: "API Token", type: "password", required: true },
    ],
  },

  // ── Communication ──
  slack: {
    id: "slack",
    name: "Slack",
    category: "communication",
    icon: "💬",
    description: "Connect to Slack workspaces",
    connectionType: "rest",
    fields: [
      { key: "botToken", label: "Bot Token (xoxb-...)", type: "password", required: true },
      { key: "signingSecret", label: "Signing Secret", type: "password", required: false },
    ],
  },
  teams: {
    id: "teams",
    name: "Microsoft Teams",
    category: "communication",
    icon: "👥",
    description: "Connect to Microsoft Teams via webhook",
    connectionType: "webhook",
    fields: [
      { key: "webhookUrl", label: "Incoming Webhook URL", type: "text", required: true },
    ],
  },

  // ── Monitoring / Observability ──
  datadog: {
    id: "datadog",
    name: "Datadog",
    category: "monitoring",
    icon: "🐕",
    description: "Connect to Datadog for metrics and logs",
    connectionType: "rest",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "appKey", label: "Application Key", type: "password", required: true },
      { key: "site", label: "Site", type: "text", required: false, default: "datadoghq.com" },
    ],
  },
  pagerduty: {
    id: "pagerduty",
    name: "PagerDuty",
    category: "monitoring",
    icon: "🚨",
    description: "Connect to PagerDuty for incident management",
    connectionType: "rest",
    fields: [
      { key: "apiToken", label: "API Token", type: "password", required: true },
    ],
  },

  // ── Generic / Custom ──
  rest_api: {
    id: "rest_api",
    name: "Custom REST API",
    category: "custom",
    icon: "🔌",
    description: "Connect to any REST API endpoint",
    connectionType: "rest",
    fields: [
      { key: "baseUrl", label: "Base URL", type: "text", required: true, placeholder: "https://api.example.com" },
      { key: "authType", label: "Auth Type", type: "select", required: true, options: ["none", "bearer", "basic", "api-key"], default: "none" },
      { key: "authToken", label: "Auth Token / API Key", type: "password", required: false },
      { key: "headerName", label: "Header Name (for API key)", type: "text", required: false, default: "Authorization" },
      { key: "username", label: "Username (for basic auth)", type: "text", required: false },
      { key: "password", label: "Password (for basic auth)", type: "password", required: false },
    ],
  },
  webhook: {
    id: "webhook",
    name: "Custom Webhook",
    category: "custom",
    icon: "🪝",
    description: "Send data to any webhook endpoint",
    connectionType: "webhook",
    fields: [
      { key: "url", label: "Webhook URL", type: "text", required: true },
      { key: "method", label: "HTTP Method", type: "select", required: true, options: ["POST", "PUT", "PATCH"], default: "POST" },
      { key: "headers", label: "Custom Headers (JSON)", type: "textarea", required: false, placeholder: '{"Authorization": "Bearer xxx"}' },
    ],
  },

  // ── Cache / KV ──
  redis: {
    id: "redis",
    name: "Redis",
    category: "database",
    icon: "🔴",
    description: "Connect to Redis for caching, pub/sub, and key-value operations",
    connectionType: "direct",
    fields: [
      { key: "host", label: "Host", type: "text", required: true, default: "localhost" },
      { key: "port", label: "Port", type: "number", required: true, default: 6379 },
      { key: "password", label: "Password", type: "password", required: false },
      { key: "url", label: "Redis URL (overrides host/port)", type: "text", required: false, placeholder: "redis://user:pass@host:6379" },
    ],
  },

  // ── Data Warehouses ──
  snowflake: {
    id: "snowflake",
    name: "Snowflake",
    category: "database",
    icon: "❄️",
    description: "Connect to Snowflake data warehouse for analytics queries",
    connectionType: "direct",
    fields: [
      { key: "account", label: "Account Identifier", type: "text", required: true, placeholder: "xy12345.us-east-1" },
      { key: "token", label: "JWT / OAuth Token", type: "password", required: true },
      { key: "database", label: "Database", type: "text", required: true },
      { key: "warehouse", label: "Warehouse", type: "text", required: true, default: "COMPUTE_WH" },
      { key: "schema", label: "Schema", type: "text", required: false, default: "PUBLIC" },
    ],
  },

  // ── Email ──
  sendgrid: {
    id: "sendgrid",
    name: "SendGrid",
    category: "communication",
    icon: "📧",
    description: "Send emails and manage email campaigns via SendGrid",
    connectionType: "api",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "fromEmail", label: "Default Sender Email", type: "text", required: false, placeholder: "noreply@yourcompany.com" },
    ],
  },

  // ── AI / LLM ──
  openai: {
    id: "openai",
    name: "OpenAI",
    category: "cloud",
    icon: "🤖",
    description: "Use GPT-4o, embeddings, and AI capabilities as tools",
    connectionType: "api",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "baseUrl", label: "Base URL (for proxies/Azure)", type: "text", required: false, default: "https://api.openai.com/v1" },
    ],
  },

  // ── Knowledge Base ──
  notion: {
    id: "notion",
    name: "Notion",
    category: "devops",
    icon: "📝",
    description: "Search, read, and create Notion pages and databases",
    connectionType: "api",
    fields: [
      { key: "apiKey", label: "Integration Token", type: "password", required: true },
    ],
  },

  // ── Containers ──
  kubernetes: {
    id: "kubernetes",
    name: "Kubernetes",
    category: "cloud",
    icon: "☸️",
    description: "Manage Kubernetes clusters — pods, deployments, services, logs",
    connectionType: "api",
    fields: [
      { key: "apiServer", label: "API Server URL", type: "text", required: true, placeholder: "https://k8s-cluster.example.com:6443" },
      { key: "token", label: "Service Account Token", type: "password", required: true },
      { key: "skipTLS", label: "Skip TLS Verification", type: "boolean", required: false, default: false },
    ],
  },

  // ── Message Queues ──
  aws_sqs: {
    id: "aws_sqs",
    name: "AWS SQS",
    category: "cloud",
    icon: "📨",
    description: "Send, receive, and manage messages in Amazon SQS queues",
    connectionType: "aws",
    fields: [
      { key: "region", label: "AWS Region", type: "text", required: true, default: "us-east-1" },
      { key: "accessKeyId", label: "Access Key ID", type: "text", required: true },
      { key: "secretAccessKey", label: "Secret Access Key", type: "password", required: true },
      { key: "sessionToken", label: "Session Token (optional)", type: "password", required: false },
    ],
  },

  // ── Security / SIEM ──
  splunk: {
    id: "splunk",
    name: "Splunk",
    category: "monitoring",
    icon: "🔍",
    description: "Search logs, get alerts, and monitor security events in Splunk",
    connectionType: "api",
    fields: [
      { key: "baseUrl", label: "Splunk API URL", type: "text", required: true, placeholder: "https://splunk.example.com:8089" },
      { key: "token", label: "Bearer Token", type: "password", required: true },
    ],
  },
};

// ─── Connection Management ───────────────────────────────────────────────────

function loadConnections() {
  try {
    return JSON.parse(fs.readFileSync(CONNECTIONS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveConnections(connections) {
  fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(connections, null, 2));
}

export function getCatalog() {
  return SERVICE_CATALOG;
}

export function getCatalogByCategory() {
  const result = {};
  for (const svc of Object.values(SERVICE_CATALOG)) {
    if (!result[svc.category]) result[svc.category] = [];
    result[svc.category].push(svc);
  }
  return result;
}

export function getServiceDefinition(serviceId) {
  return SERVICE_CATALOG[serviceId] || null;
}

export function getAllConnections() {
  return loadConnections();
}

export function getConnection(connectionId) {
  const conns = loadConnections();
  return conns[connectionId] || null;
}

export function getConnectionsByService(serviceId) {
  const conns = loadConnections();
  return Object.values(conns).filter(c => c.serviceId === serviceId);
}

export function getActiveConnections() {
  const conns = loadConnections();
  return Object.values(conns).filter(c => c.status === "connected");
}

export function saveConnection(connectionId, serviceId, config, name) {
  const conns = loadConnections();
  conns[connectionId] = {
    id: connectionId,
    serviceId,
    name: name || `${SERVICE_CATALOG[serviceId]?.name || serviceId} connection`,
    config,
    status: "configured", // configured | connected | error
    createdAt: conns[connectionId]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastTestedAt: null,
    error: null,
  };
  saveConnections(conns);
  return conns[connectionId];
}

export function updateConnectionStatus(connectionId, status, error = null) {
  const conns = loadConnections();
  if (conns[connectionId]) {
    conns[connectionId].status = status;
    conns[connectionId].error = error;
    conns[connectionId].lastTestedAt = new Date().toISOString();
    conns[connectionId].updatedAt = new Date().toISOString();
    saveConnections(conns);
  }
  return conns[connectionId];
}

export function deleteConnection(connectionId) {
  const conns = loadConnections();
  delete conns[connectionId];
  saveConnections(conns);
}

export function generateConnectionId(serviceId) {
  return `${serviceId}_${Date.now().toString(36)}`;
}
