#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CloudWatchLogsClient, FilterLogEventsCommand, DescribeLogGroupsCommand, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { S3Client, GetObjectCommand, ListObjectsV2Command, ListBucketsCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import { Client as PgClient } from "pg";
import { Client as EsClient } from "@elastic/elasticsearch";

// ─── Config ───────────────────────────────────────────────────────────────────
const AWS_PROFILE = process.env.AWS_PROFILE || "default";
const AWS_REGION   = process.env.AWS_REGION  || "ap-south-1";

const RDS_CONFIG = {
  host:     process.env.RDS_HOST     || "localhost",
  port:     parseInt(process.env.RDS_PORT || "5432"),
  database: process.env.RDS_DATABASE || "postgres",
  user:     process.env.RDS_USER     || "postgres",
  password: process.env.RDS_PASSWORD || "",
  ssl:      process.env.RDS_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
};

const ES_CONFIG = {
  node: process.env.ES_NODE || "http://localhost:9200",
  ...(process.env.ES_USERNAME && {
    auth: { username: process.env.ES_USERNAME, password: process.env.ES_PASSWORD || "" }
  }),
};

// ─── AWS credential provider (reads ~/.aws/credentials via Anvil session) ─────
function awsCredentials() {
  return fromIni({ profile: AWS_PROFILE });
}

function makeCloudWatchClient() {
  return new CloudWatchLogsClient({ region: AWS_REGION, credentials: awsCredentials() });
}
function makeS3Client() {
  return new S3Client({ region: AWS_REGION, credentials: awsCredentials() });
}
function makeDynamoClient() {
  const base = new DynamoDBClient({ region: AWS_REGION, credentials: awsCredentials() });
  return DynamoDBDocumentClient.from(base);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function pgQuery(sql, params = []) {
  const client = new PgClient(RDS_CONFIG);
  await client.connect();
  try {
    const res = await client.query(sql, params);
    return res;
  } finally {
    await client.end();
  }
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", d => chunks.push(d));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

function ok(data) {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function err(msg) {
  return { content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true };
}

// ─── MCP Server ───────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "dev-agent",
  version: "1.0.0",
  description: "Unified agent: RDS PostgreSQL, CloudWatch, S3, DynamoDB, Elasticsearch"
});

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 1 – RDS PostgreSQL
// ══════════════════════════════════════════════════════════════════════════════
server.tool(
  "rds_query",
  "Run a read-only SQL query on RDS PostgreSQL. Use for fetching records, analysing data, debugging queries.",
  {
    sql:    z.string().describe("SQL query to execute (SELECT only)"),
    limit:  z.number().optional().default(100).describe("Max rows to return"),
  },
  async ({ sql, limit }) => {
    const normalised = sql.trim().toLowerCase();
    if (!normalised.startsWith("select") && !normalised.startsWith("with") && !normalised.startsWith("explain")) {
      return err("Only SELECT / WITH / EXPLAIN queries are allowed for safety.");
    }
    const safeSql = normalised.includes("limit") ? sql : `${sql} LIMIT ${limit}`;
    try {
      const res = await pgQuery(safeSql);
      return ok({ rowCount: res.rowCount, rows: res.rows, fields: res.fields.map(f => f.name) });
    } catch (e) {
      return err(e.message);
    }
  }
);

server.tool(
  "rds_schema",
  "Get table schema, columns, indexes, and row counts from RDS PostgreSQL — useful for understanding DB structure before querying.",
  {
    table:  z.string().optional().describe("Specific table name. Omit to list all tables."),
    schema: z.string().optional().default("public").describe("Schema name"),
  },
  async ({ table, schema }) => {
    try {
      if (!table) {
        const res = await pgQuery(
          `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
          [schema]
        );
        return ok(res.rows);
      }
      const cols = await pgQuery(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`,
        [schema, table]
      );
      const idxRes = await pgQuery(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=$2`,
        [schema, table]
      );
      const countRes = await pgQuery(`SELECT COUNT(*) FROM "${schema}"."${table}"`);
      return ok({ table, columns: cols.rows, indexes: idxRes.rows, rowCount: countRes.rows[0].count });
    } catch (e) {
      return err(e.message);
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 2 – CloudWatch Logs
// ══════════════════════════════════════════════════════════════════════════════
server.tool(
  "cloudwatch_search_logs",
  "Search CloudWatch log groups for errors, exceptions, or any pattern. Ideal for debugging prod issues and finding root causes.",
  {
    logGroupName:  z.string().describe("CloudWatch log group name, e.g. /aws/lambda/my-function"),
    filterPattern: z.string().optional().default("ERROR").describe("Filter pattern, e.g. 'ERROR', 'Exception', '5xx'"),
    startMinsAgo:  z.number().optional().default(60).describe("How many minutes back to search"),
    limit:         z.number().optional().default(50).describe("Max events to return"),
  },
  async ({ logGroupName, filterPattern, startMinsAgo, limit }) => {
    try {
      const cw = makeCloudWatchClient();
      const startTime = Date.now() - startMinsAgo * 60 * 1000;
      const cmd = new FilterLogEventsCommand({
        logGroupName,
        filterPattern,
        startTime,
        limit,
      });
      const res = await cw.send(cmd);
      const events = (res.events || []).map(e => ({
        timestamp: new Date(e.timestamp).toISOString(),
        message:   e.message.trim(),
        stream:    e.logStreamName,
      }));
      return ok({ count: events.length, filterPattern, events });
    } catch (e) {
      return err(e.message);
    }
  }
);

server.tool(
  "cloudwatch_list_log_groups",
  "List available CloudWatch log groups — use this first to discover log group names.",
  {
    prefix: z.string().optional().describe("Filter by prefix, e.g. /aws/lambda"),
    limit:  z.number().optional().default(50),
  },
  async ({ prefix, limit }) => {
    try {
      const cw = makeCloudWatchClient();
      const cmd = new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix, limit });
      const res = await cw.send(cmd);
      return ok((res.logGroups || []).map(g => ({
        name:          g.logGroupName,
        retentionDays: g.retentionInDays,
        storedBytes:   g.storedBytes,
      })));
    } catch (e) {
      return err(e.message);
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 3 – S3
// ══════════════════════════════════════════════════════════════════════════════
server.tool(
  "s3_list",
  "List S3 buckets or objects inside a bucket/prefix. Use to explore what files are available.",
  {
    bucket: z.string().optional().describe("Bucket name. Omit to list all buckets."),
    prefix: z.string().optional().describe("Key prefix / folder path"),
    limit:  z.number().optional().default(50),
  },
  async ({ bucket, prefix, limit }) => {
    try {
      const s3 = makeS3Client();
      if (!bucket) {
        const res = await s3.send(new ListBucketsCommand({}));
        return ok((res.Buckets || []).map(b => ({ name: b.Name, created: b.CreationDate })));
      }
      const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: limit }));
      return ok((res.Contents || []).map(o => ({ key: o.Key, size: o.Size, modified: o.LastModified })));
    } catch (e) {
      return err(e.message);
    }
  }
);

server.tool(
  "s3_get_file",
  "Download and return the content of a file from S3. Works for JSON, CSV, text, and log files.",
  {
    bucket:      z.string().describe("S3 bucket name"),
    key:         z.string().describe("Object key / file path"),
    maxBytes:    z.number().optional().default(50000).describe("Max bytes to return (default 50KB)"),
  },
  async ({ bucket, key, maxBytes }) => {
    try {
      const s3  = makeS3Client();
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      let content = await streamToString(res.Body);
      const truncated = content.length > maxBytes;
      if (truncated) content = content.slice(0, maxBytes) + `\n\n... [truncated — ${content.length} total bytes]`;
      return ok({ bucket, key, contentType: res.ContentType, size: res.ContentLength, truncated, content });
    } catch (e) {
      return err(e.message);
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 4 – DynamoDB
// ══════════════════════════════════════════════════════════════════════════════
server.tool(
  "dynamodb_get_item",
  "Fetch a single item from DynamoDB by its primary key.",
  {
    table:    z.string().describe("DynamoDB table name"),
    key:      z.record(z.any()).describe("Primary key object, e.g. {userId: '123'} or {pk: 'USER#123', sk: 'PROFILE'}"),
  },
  async ({ table, key }) => {
    try {
      const dynamo = makeDynamoClient();
      const res = await dynamo.send(new GetCommand({ TableName: table, Key: key }));
      return ok(res.Item || null);
    } catch (e) {
      return err(e.message);
    }
  }
);

server.tool(
  "dynamodb_query",
  "Query a DynamoDB table or index using a key condition expression.",
  {
    table:                  z.string().describe("DynamoDB table name"),
    keyConditionExpression: z.string().describe("Key condition, e.g. 'userId = :uid'"),
    expressionValues:       z.record(z.any()).describe("Values map, e.g. {':uid': 'user-123'}"),
    indexName:              z.string().optional().describe("GSI/LSI name if querying an index"),
    limit:                  z.number().optional().default(50),
  },
  async ({ table, keyConditionExpression, expressionValues, indexName, limit }) => {
    try {
      const dynamo = makeDynamoClient();
      const res = await dynamo.send(new QueryCommand({
        TableName:                 table,
        IndexName:                 indexName,
        KeyConditionExpression:    keyConditionExpression,
        ExpressionAttributeValues: expressionValues,
        Limit:                     limit,
      }));
      return ok({ count: res.Count, items: res.Items });
    } catch (e) {
      return err(e.message);
    }
  }
);

server.tool(
  "dynamodb_scan",
  "Scan a DynamoDB table with an optional filter. Use sparingly — prefer query when possible.",
  {
    table:            z.string().describe("DynamoDB table name"),
    filterExpression: z.string().optional().describe("Filter expression, e.g. 'status = :s'"),
    expressionValues: z.record(z.any()).optional().describe("Values map for filter"),
    limit:            z.number().optional().default(50),
  },
  async ({ table, filterExpression, expressionValues, limit }) => {
    try {
      const dynamo = makeDynamoClient();
      const params = { TableName: table, Limit: limit };
      if (filterExpression) {
        params.FilterExpression = filterExpression;
        params.ExpressionAttributeValues = expressionValues;
      }
      const res = await dynamo.send(new ScanCommand(params));
      return ok({ count: res.Count, scannedCount: res.ScannedCount, items: res.Items });
    } catch (e) {
      return err(e.message);
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 5 – Elasticsearch / OpenSearch
// ══════════════════════════════════════════════════════════════════════════════
server.tool(
  "elastic_search",
  "Search Elasticsearch/OpenSearch index. Supports full-text search, filters, aggregations.",
  {
    index:  z.string().describe("Index name or pattern, e.g. 'logs-*' or 'products'"),
    query:  z.record(z.any()).describe("Elasticsearch query DSL object, e.g. {match: {message: 'error'}}"),
    size:   z.number().optional().default(20).describe("Number of hits to return"),
    sort:   z.array(z.record(z.any())).optional().describe("Sort array, e.g. [{timestamp: {order: 'desc'}}]"),
    source: z.array(z.string()).optional().describe("Fields to return, e.g. ['message', 'timestamp']"),
  },
  async ({ index, query, size, sort, source }) => {
    try {
      const es = new EsClient(ES_CONFIG);
      const body = { query, size };
      if (sort)   body.sort = sort;
      if (source) body._source = source;
      const res = await es.search({ index, body });
      const hits = res.hits.hits.map(h => ({ id: h._id, score: h._score, ...h._source }));
      return ok({ total: res.hits.total?.value, hits });
    } catch (e) {
      return err(e.message);
    }
  }
);

server.tool(
  "elastic_get_indices",
  "List all Elasticsearch/OpenSearch indices with doc counts and sizes.",
  {
    pattern: z.string().optional().default("*").describe("Index pattern to filter, e.g. 'logs-*'"),
  },
  async ({ pattern }) => {
    try {
      const es = new EsClient(ES_CONFIG);
      const res = await es.cat.indices({ index: pattern, format: "json", h: "index,health,status,docs.count,store.size" });
      return ok(res);
    } catch (e) {
      return err(e.message);
    }
  }
);

server.tool(
  "elastic_get_mapping",
  "Get field mappings for an Elasticsearch index — useful to understand the schema before querying.",
  {
    index: z.string().describe("Index name"),
  },
  async ({ index }) => {
    try {
      const es = new EsClient(ES_CONFIG);
      const res = await es.indices.getMapping({ index });
      return ok(res);
    } catch (e) {
      return err(e.message);
    }
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("dev-agent MCP server running");
