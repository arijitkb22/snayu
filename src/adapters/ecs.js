/**
 * AWS ECS Adapter
 */

import { ECSClient, ListClustersCommand, DescribeClustersCommand, ListServicesCommand, DescribeServicesCommand, ListTasksCommand, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";
import { makeAwsCredentialProvider } from "../core/aws-credentials.js";

export default class ECSAdapter extends BaseAdapter {
  _makeClient() {
    return new ECSClient({
      region: this.config.region || "ap-south-1",
      credentials: makeAwsCredentialProvider(this.config),
    });
  }

  async testConnection() {
    try {
      const client = this._makeClient();
      await client.send(new ListClustersCommand({ maxResults: 1 }));
      return { ok: true, message: "Connected to AWS ECS" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__list_clusters`,
        description: `List ECS clusters (${this.connection.name})`,
        schema: {},
      },
      {
        name: `${prefix}__describe_clusters`,
        description: `Get detailed info about ECS clusters including active services and tasks count (${this.connection.name})`,
        schema: {
          clusters: z.array(z.string()).describe("Cluster ARNs or names"),
        },
      },
      {
        name: `${prefix}__list_services`,
        description: `List services in an ECS cluster (${this.connection.name})`,
        schema: {
          cluster: z.string().describe("Cluster ARN or name"),
          limit: z.number().optional().default(50),
        },
      },
      {
        name: `${prefix}__describe_services`,
        description: `Get detailed info about ECS services including deployments, desired/running count, load balancers (${this.connection.name})`,
        schema: {
          cluster: z.string().describe("Cluster ARN or name"),
          services: z.array(z.string()).describe("Service ARNs or names"),
        },
      },
      {
        name: `${prefix}__list_tasks`,
        description: `List tasks in an ECS cluster, optionally filtered by service (${this.connection.name})`,
        schema: {
          cluster: z.string().describe("Cluster ARN or name"),
          serviceName: z.string().optional().describe("Filter by service name"),
          desiredStatus: z.string().optional().default("RUNNING").describe("RUNNING or STOPPED"),
          limit: z.number().optional().default(50),
        },
      },
      {
        name: `${prefix}__describe_tasks`,
        description: `Get detailed info about specific ECS tasks including containers, health, and stopped reason (${this.connection.name})`,
        schema: {
          cluster: z.string().describe("Cluster ARN or name"),
          tasks: z.array(z.string()).describe("Task ARNs"),
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
          return ok(res.clusterArns?.map(arn => ({ arn, name: arn.split("/").pop() })));
        }
        case "describe_clusters": {
          const res = await client.send(new DescribeClustersCommand({ clusters: args.clusters, include: ["STATISTICS"] }));
          return ok(res.clusters?.map(c => ({
            name: c.clusterName, status: c.status, activeServices: c.activeServicesCount,
            runningTasks: c.runningTasksCount, pendingTasks: c.pendingTasksCount,
            registeredInstances: c.registeredContainerInstancesCount,
          })));
        }
        case "list_services": {
          const res = await client.send(new ListServicesCommand({ cluster: args.cluster, maxResults: args.limit || 50 }));
          return ok(res.serviceArns?.map(arn => ({ arn, name: arn.split("/").pop() })));
        }
        case "describe_services": {
          const res = await client.send(new DescribeServicesCommand({ cluster: args.cluster, services: args.services }));
          return ok(res.services?.map(s => ({
            name: s.serviceName, status: s.status, desired: s.desiredCount, running: s.runningCount, pending: s.pendingCount,
            taskDef: s.taskDefinition?.split("/").pop(), launchType: s.launchType,
            deployments: s.deployments?.map(d => ({ status: d.status, desired: d.desiredCount, running: d.runningCount, rolloutState: d.rolloutState })),
            events: s.events?.slice(0, 5).map(e => ({ at: e.createdAt, message: e.message })),
          })));
        }
        case "list_tasks": {
          const params = { cluster: args.cluster, maxResults: args.limit || 50, desiredStatus: args.desiredStatus || "RUNNING" };
          if (args.serviceName) params.serviceName = args.serviceName;
          const res = await client.send(new ListTasksCommand(params));
          return ok(res.taskArns?.map(arn => ({ arn, id: arn.split("/").pop() })));
        }
        case "describe_tasks": {
          const res = await client.send(new DescribeTasksCommand({ cluster: args.cluster, tasks: args.tasks }));
          return ok(res.tasks?.map(t => ({
            taskArn: t.taskArn, status: t.lastStatus, desiredStatus: t.desiredStatus, healthStatus: t.healthStatus,
            cpu: t.cpu, memory: t.memory, startedAt: t.startedAt, stoppedAt: t.stoppedAt, stoppedReason: t.stoppedReason,
            containers: t.containers?.map(c => ({ name: c.name, status: c.lastStatus, exitCode: c.exitCode, reason: c.reason })),
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
