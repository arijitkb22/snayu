/**
 * AWS IAM Adapter (read-only)
 */

import { IAMClient, ListUsersCommand, ListRolesCommand, ListPoliciesCommand, GetUserCommand, ListAttachedUserPoliciesCommand, ListAttachedRolePoliciesCommand } from "@aws-sdk/client-iam";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";
import { makeAwsCredentialProvider } from "../core/aws-credentials.js";

export default class IAMAdapter extends BaseAdapter {
  _makeClient() {
    return new IAMClient({
      region: "us-east-1", // IAM is global
      credentials: makeAwsCredentialProvider(this.config),
    });
  }

  async testConnection() {
    try {
      const client = this._makeClient();
      await client.send(new ListUsersCommand({ MaxItems: 1 }));
      return { ok: true, message: "Connected to AWS IAM" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__list_users`,
        description: `List IAM users (${this.connection.name})`,
        schema: {
          limit: z.number().optional().default(50),
          pathPrefix: z.string().optional().default("/"),
        },
      },
      {
        name: `${prefix}__get_user`,
        description: `Get IAM user details including creation date, attached policies (${this.connection.name})`,
        schema: {
          userName: z.string().describe("IAM username"),
        },
      },
      {
        name: `${prefix}__list_roles`,
        description: `List IAM roles (${this.connection.name})`,
        schema: {
          limit: z.number().optional().default(50),
          pathPrefix: z.string().optional().default("/"),
        },
      },
      {
        name: `${prefix}__list_policies`,
        description: `List IAM policies (${this.connection.name})`,
        schema: {
          scope: z.string().optional().default("Local").describe("All, AWS, or Local"),
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
        case "list_users": {
          const res = await client.send(new ListUsersCommand({ MaxItems: args.limit || 50, PathPrefix: args.pathPrefix }));
          return ok(res.Users?.map(u => ({ name: u.UserName, id: u.UserId, arn: u.Arn, created: u.CreateDate, lastUsed: u.PasswordLastUsed })));
        }
        case "get_user": {
          const [userRes, policiesRes] = await Promise.all([
            client.send(new GetUserCommand({ UserName: args.userName })),
            client.send(new ListAttachedUserPoliciesCommand({ UserName: args.userName })),
          ]);
          return ok({
            user: { name: userRes.User?.UserName, arn: userRes.User?.Arn, created: userRes.User?.CreateDate },
            attachedPolicies: policiesRes.AttachedPolicies?.map(p => ({ name: p.PolicyName, arn: p.PolicyArn })),
          });
        }
        case "list_roles": {
          const res = await client.send(new ListRolesCommand({ MaxItems: args.limit || 50, PathPrefix: args.pathPrefix }));
          return ok(res.Roles?.map(r => ({ name: r.RoleName, arn: r.Arn, created: r.CreateDate, description: r.Description })));
        }
        case "list_policies": {
          const res = await client.send(new ListPoliciesCommand({ MaxItems: args.limit || 50, Scope: args.scope || "Local" }));
          return ok(res.Policies?.map(p => ({ name: p.PolicyName, arn: p.Arn, attachmentCount: p.AttachmentCount, created: p.CreateDate })));
        }
        default:
          return err(`Unknown action: ${action}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
