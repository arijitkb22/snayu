/**
 * AWS Lambda Adapter
 */

import { LambdaClient, ListFunctionsCommand, GetFunctionCommand, InvokeCommand, ListEventSourceMappingsCommand } from "@aws-sdk/client-lambda";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";
import { makeAwsCredentialProvider } from "../core/aws-credentials.js";

export default class LambdaAdapter extends BaseAdapter {
  _makeClient() {
    return new LambdaClient({
      region: this.config.region || "ap-south-1",
      credentials: makeAwsCredentialProvider(this.config),
    });
  }

  async testConnection() {
    try {
      const client = this._makeClient();
      await client.send(new ListFunctionsCommand({ MaxItems: 1 }));
      return { ok: true, message: "Connected to AWS Lambda" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__list_functions`,
        description: `List Lambda functions (${this.connection.name})`,
        schema: {
          limit: z.number().optional().default(50),
          marker: z.string().optional().describe("Pagination marker"),
        },
      },
      {
        name: `${prefix}__get_function`,
        description: `Get details of a Lambda function including configuration, code location, and tags (${this.connection.name})`,
        schema: {
          functionName: z.string().describe("Function name or ARN"),
        },
      },
      {
        name: `${prefix}__invoke_function`,
        description: `Invoke a Lambda function with a JSON payload. Use for testing or triggering functions. (${this.connection.name})`,
        schema: {
          functionName: z.string().describe("Function name or ARN"),
          payload: z.string().optional().default("{}").describe("JSON payload string"),
          invocationType: z.string().optional().default("RequestResponse").describe("RequestResponse (sync) or Event (async)"),
        },
      },
      {
        name: `${prefix}__list_event_sources`,
        description: `List event source mappings for a Lambda function (${this.connection.name})`,
        schema: {
          functionName: z.string().optional().describe("Filter by function name"),
          limit: z.number().optional().default(50),
        },
      },
    ];
  }

  async callTool(toolName, args) {
    const client = this._makeClient();
    const action = toolName.split("__").pop();

    try {
      switch (action) {
        case "list_functions": {
          const res = await client.send(new ListFunctionsCommand({ MaxItems: args.limit || 50, Marker: args.marker }));
          return ok(res.Functions?.map(f => ({ name: f.FunctionName, runtime: f.Runtime, memory: f.MemorySize, timeout: f.Timeout, lastModified: f.LastModified, codeSize: f.CodeSize })));
        }
        case "get_function": {
          const res = await client.send(new GetFunctionCommand({ FunctionName: args.functionName }));
          return ok({ config: res.Configuration, tags: res.Tags, codeLocation: res.Code?.Location ? "(presigned URL available)" : "N/A" });
        }
        case "invoke_function": {
          const res = await client.send(new InvokeCommand({
            FunctionName: args.functionName,
            Payload: Buffer.from(args.payload || "{}"),
            InvocationType: args.invocationType || "RequestResponse",
          }));
          const responsePayload = res.Payload ? Buffer.from(res.Payload).toString() : null;
          return ok({ statusCode: res.StatusCode, functionError: res.FunctionError || null, payload: responsePayload });
        }
        case "list_event_sources": {
          const params = { MaxItems: args.limit || 50 };
          if (args.functionName) params.FunctionName = args.functionName;
          const res = await client.send(new ListEventSourceMappingsCommand(params));
          return ok(res.EventSourceMappings?.map(m => ({ uuid: m.UUID, source: m.EventSourceArn, state: m.State, batchSize: m.BatchSize })));
        }
        default:
          return err(`Unknown action: ${action}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
