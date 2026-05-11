/**
 * DynamoDB Adapter
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";
import { makeAwsCredentialProvider } from "../core/aws-credentials.js";

export default class DynamoDBAdapter extends BaseAdapter {
  _makeClient() {
    const opts = {
      region: this.config.region || "ap-south-1",
      credentials: makeAwsCredentialProvider(this.config),
    };
    return DynamoDBDocumentClient.from(new DynamoDBClient(opts));
  }

  async testConnection() {
    try {
      const client = this._makeClient();
      // Try a minimal scan to verify access
      await client.send(new ScanCommand({ TableName: "__test__", Limit: 1 }));
      return { ok: true, message: "Connected to DynamoDB" };
    } catch (e) {
      // ResourceNotFoundException is expected for __test__, which means credentials work
      if (e.name === "ResourceNotFoundException") {
        return { ok: true, message: `Connected to DynamoDB (${this.config.region})` };
      }
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__get_item`,
        description: `Get a single item from DynamoDB by primary key (${this.connection.name})`,
        schema: {
          table: z.string().describe("Table name"),
          key: z.record(z.any()).describe("Primary key, e.g. {userId: '123'}"),
        },
      },
      {
        name: `${prefix}__query`,
        description: `Query a DynamoDB table (${this.connection.name})`,
        schema: {
          table: z.string().describe("Table name"),
          keyConditionExpression: z.string().describe("Key condition, e.g. 'userId = :uid'"),
          expressionValues: z.record(z.any()).describe("Values map, e.g. {':uid': 'user-123'}"),
          indexName: z.string().optional(),
          limit: z.number().optional().default(50),
        },
      },
      {
        name: `${prefix}__scan`,
        description: `Scan a DynamoDB table (${this.connection.name})`,
        schema: {
          table: z.string().describe("Table name"),
          filterExpression: z.string().optional(),
          expressionValues: z.record(z.any()).optional(),
          limit: z.number().optional().default(50),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    const client = this._makeClient();
    try {
      switch (action) {
        case "get_item": {
          const res = await client.send(new GetCommand({ TableName: params.table, Key: params.key }));
          return ok(res.Item || null);
        }
        case "query": {
          const res = await client.send(new QueryCommand({
            TableName: params.table,
            IndexName: params.indexName,
            KeyConditionExpression: params.keyConditionExpression,
            ExpressionAttributeValues: params.expressionValues,
            Limit: params.limit || 50,
          }));
          return ok({ count: res.Count, items: res.Items });
        }
        case "scan": {
          const cmdParams = { TableName: params.table, Limit: params.limit || 50 };
          if (params.filterExpression) {
            cmdParams.FilterExpression = params.filterExpression;
            cmdParams.ExpressionAttributeValues = params.expressionValues;
          }
          const res = await client.send(new ScanCommand(cmdParams));
          return ok({ count: res.Count, scannedCount: res.ScannedCount, items: res.Items });
        }
        default: return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
