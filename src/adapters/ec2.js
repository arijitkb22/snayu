/**
 * AWS EC2 Adapter
 */

import { EC2Client, DescribeInstancesCommand, DescribeSecurityGroupsCommand, DescribeVpcsCommand, DescribeSubnetsCommand } from "@aws-sdk/client-ec2";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";
import { makeAwsCredentialProvider } from "../core/aws-credentials.js";

export default class EC2Adapter extends BaseAdapter {
  _makeClient() {
    return new EC2Client({
      region: this.config.region || "ap-south-1",
      credentials: makeAwsCredentialProvider(this.config),
    });
  }

  async testConnection() {
    try {
      const client = this._makeClient();
      await client.send(new DescribeInstancesCommand({ MaxResults: 5 }));
      return { ok: true, message: "Connected to AWS EC2" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__describe_instances`,
        description: `List EC2 instances with details like state, type, IP, tags (${this.connection.name})`,
        schema: {
          instanceIds: z.array(z.string()).optional().describe("Filter by instance IDs"),
          filters: z.string().optional().describe("JSON array of {Name,Values} filters, e.g. [{\"Name\":\"instance-state-name\",\"Values\":[\"running\"]}]"),
          limit: z.number().optional().default(50),
        },
      },
      {
        name: `${prefix}__describe_security_groups`,
        description: `List security groups with inbound/outbound rules (${this.connection.name})`,
        schema: {
          groupIds: z.array(z.string()).optional().describe("Filter by security group IDs"),
          limit: z.number().optional().default(50),
        },
      },
      {
        name: `${prefix}__describe_vpcs`,
        description: `List VPCs (${this.connection.name})`,
        schema: {},
      },
      {
        name: `${prefix}__describe_subnets`,
        description: `List subnets, optionally filtered by VPC (${this.connection.name})`,
        schema: {
          vpcId: z.string().optional().describe("Filter by VPC ID"),
        },
      },
    ];
  }

  async callTool(toolName, args) {
    const client = this._makeClient();
    const action = toolName.split("__").pop();

    try {
      switch (action) {
        case "describe_instances": {
          const params = { MaxResults: args.limit || 50 };
          if (args.instanceIds?.length) params.InstanceIds = args.instanceIds;
          if (args.filters) params.Filters = JSON.parse(args.filters);
          const res = await client.send(new DescribeInstancesCommand(params));
          const instances = [];
          for (const r of res.Reservations || []) {
            for (const i of r.Instances || []) {
              instances.push({
                id: i.InstanceId, type: i.InstanceType, state: i.State?.Name,
                az: i.Placement?.AvailabilityZone, publicIp: i.PublicIpAddress,
                privateIp: i.PrivateIpAddress, launchTime: i.LaunchTime,
                tags: i.Tags?.reduce((o, t) => { o[t.Key] = t.Value; return o; }, {}),
              });
            }
          }
          return ok(instances);
        }
        case "describe_security_groups": {
          const params = {};
          if (args.groupIds?.length) params.GroupIds = args.groupIds;
          const res = await client.send(new DescribeSecurityGroupsCommand(params));
          return ok(res.SecurityGroups?.map(sg => ({
            id: sg.GroupId, name: sg.GroupName, vpcId: sg.VpcId, description: sg.Description,
            inbound: sg.IpPermissions?.length, outbound: sg.IpPermissionsEgress?.length,
          })));
        }
        case "describe_vpcs": {
          const res = await client.send(new DescribeVpcsCommand({}));
          return ok(res.Vpcs?.map(v => ({ id: v.VpcId, cidr: v.CidrBlock, state: v.State, isDefault: v.IsDefault })));
        }
        case "describe_subnets": {
          const params = {};
          if (args.vpcId) params.Filters = [{ Name: "vpc-id", Values: [args.vpcId] }];
          const res = await client.send(new DescribeSubnetsCommand(params));
          return ok(res.Subnets?.map(s => ({ id: s.SubnetId, vpcId: s.VpcId, az: s.AvailabilityZone, cidr: s.CidrBlock, availableIps: s.AvailableIpAddressCount })));
        }
        default:
          return err(`Unknown action: ${action}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
