/**
 * AWS SNS Adapter
 */

import { SNSClient, ListTopicsCommand, ListSubscriptionsCommand, GetTopicAttributesCommand, PublishCommand } from "@aws-sdk/client-sns";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";
import { makeAwsCredentialProvider } from "../core/aws-credentials.js";

export default class SNSAdapter extends BaseAdapter {
  _makeClient() {
    return new SNSClient({
      region: this.config.region || "ap-south-1",
      credentials: makeAwsCredentialProvider(this.config),
    });
  }

  async testConnection() {
    try {
      const client = this._makeClient();
      await client.send(new ListTopicsCommand({}));
      return { ok: true, message: "Connected to AWS SNS" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__list_topics`,
        description: `List SNS topics (${this.connection.name})`,
        schema: {},
      },
      {
        name: `${prefix}__get_topic`,
        description: `Get SNS topic attributes (subscriptions count, policy, etc.) (${this.connection.name})`,
        schema: {
          topicArn: z.string().describe("Topic ARN"),
        },
      },
      {
        name: `${prefix}__list_subscriptions`,
        description: `List SNS subscriptions (${this.connection.name})`,
        schema: {
          topicArn: z.string().optional().describe("Filter by topic ARN"),
        },
      },
      {
        name: `${prefix}__publish`,
        description: `Publish a message to an SNS topic (${this.connection.name})`,
        schema: {
          topicArn: z.string().describe("Topic ARN"),
          message: z.string().describe("Message body"),
          subject: z.string().optional().describe("Message subject (for email subscriptions)"),
        },
      },
    ];
  }

  async callTool(toolName, args) {
    const client = this._makeClient();
    const action = toolName.split("__").pop();

    try {
      switch (action) {
        case "list_topics": {
          const res = await client.send(new ListTopicsCommand({}));
          return ok(res.Topics?.map(t => ({ arn: t.TopicArn, name: t.TopicArn?.split(":").pop() })));
        }
        case "get_topic": {
          const res = await client.send(new GetTopicAttributesCommand({ TopicArn: args.topicArn }));
          return ok(res.Attributes);
        }
        case "list_subscriptions": {
          const params = {};
          if (args.topicArn) params.TopicArn = args.topicArn;
          const res = await client.send(new ListSubscriptionsCommand(params));
          return ok(res.Subscriptions?.map(s => ({ arn: s.SubscriptionArn, protocol: s.Protocol, endpoint: s.Endpoint, topicArn: s.TopicArn })));
        }
        case "publish": {
          const params = { TopicArn: args.topicArn, Message: args.message };
          if (args.subject) params.Subject = args.subject;
          const res = await client.send(new PublishCommand(params));
          return ok({ messageId: res.MessageId });
        }
        default:
          return err(`Unknown action: ${action}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
