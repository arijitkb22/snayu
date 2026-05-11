/**
 * AWS SQS Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class SQSAdapter extends BaseAdapter {
  _getCredentials() {
    return {
      region: this.config.region || "us-east-1",
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      sessionToken: this.config.sessionToken,
    };
  }

  async _sqs(action, params = {}) {
    const { SQSClient } = await import("@aws-sdk/client-sqs");
    const client = new SQSClient(this._getCredentials());
    const { __module, ...cmdParams } = params;
    const mod = await import("@aws-sdk/client-sqs");
    const CmdClass = mod[action];
    return client.send(new CmdClass(cmdParams));
  }

  async testConnection() {
    try {
      const data = await this._sqs("ListQueuesCommand", {});
      return { ok: true, message: `Connected — ${data.QueueUrls?.length || 0} queues found` };
    } catch (e) { return { ok: false, message: e.message }; }
  }

  getTools() {
    const p = this.connection.id;
    return [
      { name: `${p}__list_queues`, description: `List SQS queues (${this.connection.name})`, schema: { prefix: z.string().optional() } },
      { name: `${p}__send_message`, description: `Send a message to an SQS queue (${this.connection.name})`, schema: { queueUrl: z.string(), body: z.string(), delaySeconds: z.number().optional().default(0) } },
      { name: `${p}__receive_messages`, description: `Receive messages from an SQS queue (${this.connection.name})`, schema: { queueUrl: z.string(), maxMessages: z.number().optional().default(5), waitTime: z.number().optional().default(5) } },
      { name: `${p}__get_queue_attributes`, description: `Get attributes of an SQS queue (${this.connection.name})`, schema: { queueUrl: z.string() } },
      { name: `${p}__purge_queue`, description: `Purge all messages from an SQS queue (${this.connection.name})`, schema: { queueUrl: z.string() } },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    try {
      switch (action) {
        case "list_queues": {
          const cmd = { ...(params.prefix ? { QueueNamePrefix: params.prefix } : {}) };
          const data = await this._sqs("ListQueuesCommand", cmd);
          return ok({ queues: data.QueueUrls || [] });
        }
        case "send_message": {
          const data = await this._sqs("SendMessageCommand", { QueueUrl: params.queueUrl, MessageBody: params.body, DelaySeconds: params.delaySeconds || 0 });
          return ok({ messageId: data.MessageId, md5: data.MD5OfMessageBody });
        }
        case "receive_messages": {
          const data = await this._sqs("ReceiveMessageCommand", { QueueUrl: params.queueUrl, MaxNumberOfMessages: params.maxMessages || 5, WaitTimeSeconds: params.waitTime || 5 });
          return ok({ count: data.Messages?.length || 0, messages: data.Messages?.map(m => ({ id: m.MessageId, body: m.Body, receiptHandle: m.ReceiptHandle })) || [] });
        }
        case "get_queue_attributes": {
          const data = await this._sqs("GetQueueAttributesCommand", { QueueUrl: params.queueUrl, AttributeNames: ["All"] });
          return ok(data.Attributes);
        }
        case "purge_queue": {
          await this._sqs("PurgeQueueCommand", { QueueUrl: params.queueUrl });
          return ok({ status: "purged", queueUrl: params.queueUrl });
        }
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e.message); }
  }
}
