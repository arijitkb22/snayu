/**
 * CloudWatch Logs + Metrics Adapter
 */

import { CloudWatchLogsClient, FilterLogEventsCommand, DescribeLogGroupsCommand, DescribeLogStreamsCommand, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { CloudWatchClient, ListMetricsCommand, GetMetricDataCommand, DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";
import { makeAwsCredentialProvider } from "../core/aws-credentials.js";

export default class CloudWatchAdapter extends BaseAdapter {
  _makeClient() {
    const opts = {
      region: this.config.region || "ap-south-1",
      credentials: makeAwsCredentialProvider(this.config),
    };
    return new CloudWatchLogsClient(opts);
  }

  _makeMetricsClient() {
    const opts = {
      region: this.config.region || "ap-south-1",
      credentials: makeAwsCredentialProvider(this.config),
    };
    return new CloudWatchClient(opts);
  }

  async testConnection() {
    try {
      const cw = this._makeClient();
      await cw.send(new DescribeLogGroupsCommand({ limit: 1 }));
      return { ok: true, message: "Connected to CloudWatch Logs" };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  getTools() {
    const prefix = this.connection.id;
    return [
      {
        name: `${prefix}__search_logs`,
        description: `Search CloudWatch log groups for patterns (${this.connection.name})`,
        schema: {
          logGroupName: z.string().describe("CloudWatch log group name"),
          filterPattern: z.string().optional().default("ERROR"),
          startMinsAgo: z.number().optional().default(60),
          limit: z.number().optional().default(50),
        },
      },
      {
        name: `${prefix}__list_log_groups`,
        description: `List CloudWatch log groups (${this.connection.name})`,
        schema: {
          prefix: z.string().optional(),
          limit: z.number().optional().default(50),
        },
      },
      {
        name: `${prefix}__get_log_streams`,
        description: `List log streams in a CloudWatch log group, ordered by last event time. Useful to find active or recent streams. (${this.connection.name})`,
        schema: {
          logGroupName: z.string().describe("Log group name"),
          orderBy: z.string().optional().default("LastEventTime").describe("LastEventTime or LogStreamName"),
          descending: z.boolean().optional().default(true),
          limit: z.number().optional().default(20),
        },
      },
      {
        name: `${prefix}__get_log_events`,
        description: `Get raw log events from a specific log stream. Use for deep-diving into a single stream's output. (${this.connection.name})`,
        schema: {
          logGroupName: z.string().describe("Log group name"),
          logStreamName: z.string().describe("Log stream name"),
          startMinsAgo: z.number().optional().default(60),
          limit: z.number().optional().default(100),
        },
      },
      {
        name: `${prefix}__list_metrics`,
        description: `List available CloudWatch metrics, optionally filtered by namespace (e.g. AWS/EC2, AWS/RDS, AWS/Lambda, AWS/ECS). Use to discover what metrics exist before querying them. (${this.connection.name})`,
        schema: {
          namespace: z.string().optional().describe("AWS namespace, e.g. AWS/EC2, AWS/RDS, AWS/Lambda, AWS/ECS, AWS/ELB"),
          metricName: z.string().optional().describe("Filter by metric name, e.g. CPUUtilization"),
          limit: z.number().optional().default(50),
        },
      },
      {
        name: `${prefix}__get_metric_data`,
        description: `Get CloudWatch metric data points for analysis. Supports statistics like Average, Sum, Maximum, Minimum, SampleCount. Essential for infrastructure health analysis. (${this.connection.name})`,
        schema: {
          namespace: z.string().describe("AWS namespace, e.g. AWS/EC2, AWS/RDS, AWS/Lambda"),
          metricName: z.string().describe("Metric name, e.g. CPUUtilization, Errors, Duration, DatabaseConnections"),
          dimensions: z.array(z.object({ Name: z.string(), Value: z.string() })).optional().describe("Metric dimensions, e.g. [{Name:'FunctionName',Value:'my-func'}]"),
          stat: z.string().optional().default("Average").describe("Statistic: Average, Sum, Maximum, Minimum, SampleCount"),
          periodSeconds: z.number().optional().default(300).describe("Period in seconds (300 = 5min)"),
          startMinsAgo: z.number().optional().default(60),
        },
      },
      {
        name: `${prefix}__describe_alarms`,
        description: `List CloudWatch alarms and their current state (OK, ALARM, INSUFFICIENT_DATA). Critical for understanding what's firing. (${this.connection.name})`,
        schema: {
          stateValue: z.string().optional().describe("Filter by state: OK, ALARM, INSUFFICIENT_DATA"),
          alarmNamePrefix: z.string().optional(),
          limit: z.number().optional().default(50),
        },
      },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    const cw = this._makeClient();
    try {
      switch (action) {
        case "search_logs": {
          const startTime = Date.now() - (params.startMinsAgo || 60) * 60 * 1000;
          const res = await cw.send(new FilterLogEventsCommand({
            logGroupName: params.logGroupName,
            filterPattern: params.filterPattern || "ERROR",
            startTime,
            limit: params.limit || 50,
          }));
          const events = (res.events || []).map(e => ({
            timestamp: new Date(e.timestamp).toISOString(),
            message: e.message.trim(),
            stream: e.logStreamName,
          }));
          return ok({ count: events.length, events });
        }
        case "list_log_groups": {
          const res = await cw.send(new DescribeLogGroupsCommand({
            logGroupNamePrefix: params.prefix,
            limit: params.limit || 50,
          }));
          return ok((res.logGroups || []).map(g => ({
            name: g.logGroupName,
            retentionDays: g.retentionInDays,
            storedBytes: g.storedBytes,
          })));
        }
        case "get_log_streams": {
          const res = await cw.send(new DescribeLogStreamsCommand({
            logGroupName: params.logGroupName,
            orderBy: params.orderBy || "LastEventTime",
            descending: params.descending !== false,
            limit: params.limit || 20,
          }));
          return ok((res.logStreams || []).map(s => ({
            name: s.logStreamName,
            lastEventTime: s.lastEventTimestamp ? new Date(s.lastEventTimestamp).toISOString() : null,
            firstEventTime: s.firstEventTimestamp ? new Date(s.firstEventTimestamp).toISOString() : null,
            storedBytes: s.storedBytes,
          })));
        }
        case "get_log_events": {
          const startTime = Date.now() - (params.startMinsAgo || 60) * 60 * 1000;
          const res = await cw.send(new GetLogEventsCommand({
            logGroupName: params.logGroupName,
            logStreamName: params.logStreamName,
            startTime,
            limit: params.limit || 100,
            startFromHead: false,
          }));
          const events = (res.events || []).map(e => ({
            timestamp: new Date(e.timestamp).toISOString(),
            message: e.message.trim(),
          }));
          return ok({ count: events.length, events });
        }
        case "list_metrics": {
          const mw = this._makeMetricsClient();
          const cmd = new ListMetricsCommand({
            Namespace: params.namespace,
            MetricName: params.metricName,
          });
          const res = await mw.send(cmd);
          const metrics = (res.Metrics || []).slice(0, params.limit || 50).map(m => ({
            namespace: m.Namespace,
            metricName: m.MetricName,
            dimensions: m.Dimensions?.map(d => ({ name: d.Name, value: d.Value })),
          }));
          return ok({ count: metrics.length, metrics });
        }
        case "get_metric_data": {
          const mw = this._makeMetricsClient();
          const endTime = new Date();
          const startTime = new Date(Date.now() - (params.startMinsAgo || 60) * 60 * 1000);
          const cmd = new GetMetricDataCommand({
            StartTime: startTime,
            EndTime: endTime,
            MetricDataQueries: [{
              Id: "m1",
              MetricStat: {
                Metric: {
                  Namespace: params.namespace,
                  MetricName: params.metricName,
                  Dimensions: params.dimensions || [],
                },
                Period: params.periodSeconds || 300,
                Stat: params.stat || "Average",
              },
            }],
          });
          const res = await mw.send(cmd);
          const result = res.MetricDataResults?.[0];
          const datapoints = (result?.Timestamps || []).map((ts, i) => ({
            timestamp: ts.toISOString(),
            value: result.Values[i],
          })).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
          return ok({
            metric: params.metricName,
            namespace: params.namespace,
            stat: params.stat || "Average",
            datapoints,
            summary: datapoints.length > 0 ? {
              min: Math.min(...datapoints.map(d => d.value)),
              max: Math.max(...datapoints.map(d => d.value)),
              avg: datapoints.reduce((s, d) => s + d.value, 0) / datapoints.length,
              count: datapoints.length,
            } : null,
          });
        }
        case "describe_alarms": {
          const mw = this._makeMetricsClient();
          const cmd = new DescribeAlarmsCommand({
            StateValue: params.stateValue,
            AlarmNamePrefix: params.alarmNamePrefix,
            MaxRecords: params.limit || 50,
          });
          const res = await mw.send(cmd);
          const alarms = (res.MetricAlarms || []).map(a => ({
            name: a.AlarmName,
            state: a.StateValue,
            stateReason: a.StateReason,
            metric: a.MetricName,
            namespace: a.Namespace,
            threshold: a.Threshold,
            comparisonOperator: a.ComparisonOperator,
            evaluationPeriods: a.EvaluationPeriods,
            updatedAt: a.StateUpdatedTimestamp?.toISOString(),
          }));
          return ok({ count: alarms.length, alarms });
        }
        default: return err(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return err(e.message);
    }
  }
}
