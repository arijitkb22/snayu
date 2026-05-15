/**
 * AWS EKS Adapter
 */

import { EKSClient, ListClustersCommand, DescribeClusterCommand, ListNodegroupsCommand, DescribeNodegroupCommand, ListFargateProfilesCommand } from "@aws-sdk/client-eks";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";
import { makeAwsCredentialProvider } from "../core/aws-credentials.js";

export default class EKSAdapter extends BaseAdapter {
  _makeClient() {
    return new EKSClient({
      region: this.config.region || "ap-south-1",
      credentials: makeAwsCredentialProvider(this.config),
    });
  }

  async testConnection() {
    try {
      const client = this._makeClient();
      await client.send(new ListClustersCommand({ maxResults: 1 }));
      return { ok: true, message: "Connected to AWS EKS" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__list_clusters`,
        description: `List EKS Kubernetes clusters (${this.connection.name})`,
        schema: {},
      },
      {
        name: `${prefix}__describe_cluster`,
        description: `Get detailed info about an EKS cluster including version, endpoint, VPC config, and status (${this.connection.name})`,
        schema: {
          clusterName: z.string().describe("Cluster name"),
        },
      },
      {
        name: `${prefix}__list_nodegroups`,
        description: `List node groups in an EKS cluster (${this.connection.name})`,
        schema: {
          clusterName: z.string().describe("Cluster name"),
        },
      },
      {
        name: `${prefix}__describe_nodegroup`,
        description: `Get details of an EKS node group including instance types, scaling config, and health (${this.connection.name})`,
        schema: {
          clusterName: z.string().describe("Cluster name"),
          nodegroupName: z.string().describe("Node group name"),
        },
      },
      {
        name: `${prefix}__list_fargate_profiles`,
        description: `List Fargate profiles in an EKS cluster (${this.connection.name})`,
        schema: {
          clusterName: z.string().describe("Cluster name"),
        },
      },
    ];
  }

  async callTool(toolName, args) {
    const client = this._makeClient();
    const action = toolName.split("__").pop();

    try {
      switch (action) {
        case "list_clusters": {
          const res = await client.send(new ListClustersCommand({}));
          return ok(res.clusters || []);
        }
        case "describe_cluster": {
          const res = await client.send(new DescribeClusterCommand({ name: args.clusterName }));
          const c = res.cluster;
          return ok({
            name: c.name, version: c.version, status: c.status, endpoint: c.endpoint,
            platformVersion: c.platformVersion, createdAt: c.createdAt,
            vpcConfig: { vpcId: c.resourcesVpcConfig?.vpcId, subnets: c.resourcesVpcConfig?.subnetIds, securityGroups: c.resourcesVpcConfig?.securityGroupIds },
            logging: c.logging?.clusterLogging?.map(l => ({ types: l.types, enabled: l.enabled })),
          });
        }
        case "list_nodegroups": {
          const res = await client.send(new ListNodegroupsCommand({ clusterName: args.clusterName }));
          return ok(res.nodegroups || []);
        }
        case "describe_nodegroup": {
          const res = await client.send(new DescribeNodegroupCommand({ clusterName: args.clusterName, nodegroupName: args.nodegroupName }));
          const ng = res.nodegroup;
          return ok({
            name: ng.nodegroupName, status: ng.status, instanceTypes: ng.instanceTypes,
            scalingConfig: ng.scalingConfig, amiType: ng.amiType, diskSize: ng.diskSize,
            health: ng.health?.issues, capacityType: ng.capacityType,
          });
        }
        case "list_fargate_profiles": {
          const res = await client.send(new ListFargateProfilesCommand({ clusterName: args.clusterName }));
          return ok(res.fargateProfileNames || []);
        }
        default:
          return err(`Unknown action: ${action}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
