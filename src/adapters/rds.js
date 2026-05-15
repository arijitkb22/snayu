/**
 * AWS RDS Adapter
 */

import { RDSClient, DescribeDBInstancesCommand, DescribeDBClustersCommand, DescribeEventsCommand, DescribeDBSnapshotsCommand } from "@aws-sdk/client-rds";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";
import { makeAwsCredentialProvider } from "../core/aws-credentials.js";

export default class RDSAdapter extends BaseAdapter {
  _makeClient() {
    return new RDSClient({
      region: this.config.region || "ap-south-1",
      credentials: makeAwsCredentialProvider(this.config),
    });
  }

  async testConnection() {
    try {
      const client = this._makeClient();
      await client.send(new DescribeDBInstancesCommand({ MaxRecords: 20 }));
      return { ok: true, message: "Connected to AWS RDS" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__describe_instances`,
        description: `List RDS database instances with status, engine, size, endpoint (${this.connection.name})`,
        schema: {
          dbInstanceId: z.string().optional().describe("Filter by DB instance identifier"),
          limit: z.number().optional().default(50),
        },
      },
      {
        name: `${prefix}__describe_clusters`,
        description: `List RDS Aurora clusters (${this.connection.name})`,
        schema: {
          dbClusterId: z.string().optional().describe("Filter by cluster identifier"),
        },
      },
      {
        name: `${prefix}__describe_events`,
        description: `List recent RDS events (maintenance, failover, errors) (${this.connection.name})`,
        schema: {
          sourceType: z.string().optional().default("db-instance").describe("db-instance, db-cluster, db-snapshot, etc."),
          durationMins: z.number().optional().default(60).describe("Events from last N minutes"),
          limit: z.number().optional().default(50),
        },
      },
      {
        name: `${prefix}__describe_snapshots`,
        description: `List RDS snapshots (${this.connection.name})`,
        schema: {
          dbInstanceId: z.string().optional().describe("Filter by DB instance"),
          snapshotType: z.string().optional().default("automated").describe("automated, manual, shared, public"),
          limit: z.number().optional().default(20),
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
          const params = { MaxRecords: args.limit || 50 };
          if (args.dbInstanceId) params.DBInstanceIdentifier = args.dbInstanceId;
          const res = await client.send(new DescribeDBInstancesCommand(params));
          return ok(res.DBInstances?.map(db => ({
            id: db.DBInstanceIdentifier, engine: `${db.Engine} ${db.EngineVersion}`,
            class: db.DBInstanceClass, status: db.DBInstanceStatus, az: db.AvailabilityZone,
            endpoint: db.Endpoint ? `${db.Endpoint.Address}:${db.Endpoint.Port}` : null,
            storage: `${db.AllocatedStorage}GB`, multiAZ: db.MultiAZ, encrypted: db.StorageEncrypted,
          })));
        }
        case "describe_clusters": {
          const params = {};
          if (args.dbClusterId) params.DBClusterIdentifier = args.dbClusterId;
          const res = await client.send(new DescribeDBClustersCommand(params));
          return ok(res.DBClusters?.map(c => ({
            id: c.DBClusterIdentifier, engine: `${c.Engine} ${c.EngineVersion}`,
            status: c.Status, endpoint: c.Endpoint, readerEndpoint: c.ReaderEndpoint,
            members: c.DBClusterMembers?.length, multiAZ: c.MultiAZ,
          })));
        }
        case "describe_events": {
          const params = { MaxRecords: args.limit || 50 };
          if (args.sourceType) params.SourceType = args.sourceType;
          if (args.durationMins) params.Duration = args.durationMins;
          const res = await client.send(new DescribeEventsCommand(params));
          return ok(res.Events?.map(e => ({ source: e.SourceIdentifier, type: e.SourceType, date: e.Date, message: e.Message })));
        }
        case "describe_snapshots": {
          const params = { MaxRecords: args.limit || 20 };
          if (args.dbInstanceId) params.DBInstanceIdentifier = args.dbInstanceId;
          if (args.snapshotType) params.SnapshotType = args.snapshotType;
          const res = await client.send(new DescribeDBSnapshotsCommand(params));
          return ok(res.DBSnapshots?.map(s => ({
            id: s.DBSnapshotIdentifier, instance: s.DBInstanceIdentifier,
            engine: s.Engine, status: s.Status, created: s.SnapshotCreateTime, size: `${s.AllocatedStorage}GB`,
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
