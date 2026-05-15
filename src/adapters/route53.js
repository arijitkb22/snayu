/**
 * AWS Route53 Adapter
 */

import { Route53Client, ListHostedZonesCommand, ListResourceRecordSetsCommand, GetHostedZoneCommand } from "@aws-sdk/client-route-53";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";
import { makeAwsCredentialProvider } from "../core/aws-credentials.js";

export default class Route53Adapter extends BaseAdapter {
  _makeClient() {
    return new Route53Client({
      region: this.config.region || "us-east-1",
      credentials: makeAwsCredentialProvider(this.config),
    });
  }

  async testConnection() {
    try {
      const client = this._makeClient();
      await client.send(new ListHostedZonesCommand({ MaxItems: "1" }));
      return { ok: true, message: "Connected to AWS Route53" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__list_hosted_zones`,
        description: `List Route53 hosted zones (${this.connection.name})`,
        schema: {
          limit: z.number().optional().default(50),
        },
      },
      {
        name: `${prefix}__get_hosted_zone`,
        description: `Get details of a Route53 hosted zone (${this.connection.name})`,
        schema: {
          hostedZoneId: z.string().describe("Hosted zone ID"),
        },
      },
      {
        name: `${prefix}__list_records`,
        description: `List DNS records in a hosted zone (${this.connection.name})`,
        schema: {
          hostedZoneId: z.string().describe("Hosted zone ID"),
          recordName: z.string().optional().describe("Start listing from this record name"),
          recordType: z.string().optional().describe("Filter by type: A, AAAA, CNAME, MX, TXT, etc."),
          limit: z.number().optional().default(100),
        },
      },
    ];
  }

  async callTool(toolName, args) {
    const client = this._makeClient();
    const action = toolName.split("__").pop();

    try {
      switch (action) {
        case "list_hosted_zones": {
          const res = await client.send(new ListHostedZonesCommand({ MaxItems: String(args.limit || 50) }));
          return ok(res.HostedZones?.map(z => ({ id: z.Id?.replace("/hostedzone/", ""), name: z.Name, recordCount: z.ResourceRecordSetCount, private: z.Config?.PrivateZone })));
        }
        case "get_hosted_zone": {
          const res = await client.send(new GetHostedZoneCommand({ Id: args.hostedZoneId }));
          return ok({ zone: res.HostedZone, nameServers: res.DelegationSet?.NameServers });
        }
        case "list_records": {
          const params = { HostedZoneId: args.hostedZoneId, MaxItems: String(args.limit || 100) };
          if (args.recordName) params.StartRecordName = args.recordName;
          if (args.recordType) params.StartRecordType = args.recordType;
          const res = await client.send(new ListResourceRecordSetsCommand(params));
          return ok(res.ResourceRecordSets?.map(r => ({
            name: r.Name, type: r.Type, ttl: r.TTL,
            values: r.ResourceRecords?.map(rr => rr.Value),
            alias: r.AliasTarget ? { dnsName: r.AliasTarget.DNSName, zoneId: r.AliasTarget.HostedZoneId } : null,
          })));
        }
        default:
          return err(`Unknown action: ${action}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
