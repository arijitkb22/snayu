/**
 * Amazon S3 Adapter
 */

import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";
import { makeAwsCredentialProvider } from "../core/aws-credentials.js";

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", d => chunks.push(d));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

export default class S3Adapter extends BaseAdapter {
  _makeClient() {
    const opts = {
      region: this.config.region || "ap-south-1",
      credentials: makeAwsCredentialProvider(this.config),
    };
    return new S3Client(opts);
  }

  async testConnection() {
    try {
      const s3 = this._makeClient();
      await s3.send(new ListBucketsCommand({}));
      return { ok: true, message: "Connected to S3" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__list`,
        description: `List S3 buckets or objects (${this.connection.name})`,
        schema: {
          bucket: z.string().optional().describe("Bucket name. Omit to list all buckets."),
          prefix: z.string().optional().describe("Key prefix / folder path"),
          limit: z.number().optional().default(50),
        },
      },
      {
        name: `${prefix}__get_file`,
        description: `Download and return content of an S3 file (${this.connection.name})`,
        schema: {
          bucket: z.string().describe("Bucket name"),
          key: z.string().describe("Object key"),
          maxBytes: z.number().optional().default(50000),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    const s3 = this._makeClient();
    try {
      switch (action) {
        case "list": {
          if (!params.bucket) {
            const res = await s3.send(new ListBucketsCommand({}));
            return ok((res.Buckets || []).map(b => ({ name: b.Name, created: b.CreationDate })));
          }
          const res = await s3.send(new ListObjectsV2Command({ Bucket: params.bucket, Prefix: params.prefix, MaxKeys: params.limit || 50 }));
          return ok((res.Contents || []).map(o => ({ key: o.Key, size: o.Size, modified: o.LastModified })));
        }
        case "get_file": {
          const res = await s3.send(new GetObjectCommand({ Bucket: params.bucket, Key: params.key }));
          let content = await streamToString(res.Body);
          const maxBytes = params.maxBytes || 50000;
          const truncated = content.length > maxBytes;
          if (truncated) content = content.slice(0, maxBytes) + `\n\n... [truncated — ${content.length} total bytes]`;
          return ok({ bucket: params.bucket, key: params.key, contentType: res.ContentType, truncated, content });
        }
        default: return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
