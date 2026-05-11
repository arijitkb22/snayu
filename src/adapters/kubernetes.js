/**
 * Kubernetes Adapter
 */

import { z } from "zod";
import { BaseAdapter, ok, err } from "../core/adapter-base.js";

export default class KubernetesAdapter extends BaseAdapter {
  async _fetch(path) {
    const base = this.config.apiServer.replace(/\/+$/, "");
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${this.config.token}`, Accept: "application/json" },
      ...(this.config.skipTLS ? { agent: undefined } : {}),
    });
    if (!res.ok) throw new Error(`K8s ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async testConnection() {
    try { const data = await this._fetch("/api/v1/namespaces"); return { ok: true, message: `Connected — ${data.items.length} namespaces` }; }
    catch (e) { return { ok: false, message: e.message }; }
  }

  getTools() {
    const p = this.connection.id;
    return [
      { name: `${p}__list_pods`, description: `List Kubernetes pods (${this.connection.name})`, schema: { namespace: z.string().optional().default("default"), label: z.string().optional().describe("Label selector e.g. app=nginx") } },
      { name: `${p}__list_deployments`, description: `List Kubernetes deployments (${this.connection.name})`, schema: { namespace: z.string().optional().default("default") } },
      { name: `${p}__list_services`, description: `List Kubernetes services (${this.connection.name})`, schema: { namespace: z.string().optional().default("default") } },
      { name: `${p}__get_pod_logs`, description: `Get logs from a Kubernetes pod (${this.connection.name})`, schema: { pod: z.string(), namespace: z.string().optional().default("default"), lines: z.number().optional().default(100) } },
      { name: `${p}__list_namespaces`, description: `List all Kubernetes namespaces (${this.connection.name})`, schema: {} },
      { name: `${p}__list_events`, description: `List recent Kubernetes events (${this.connection.name})`, schema: { namespace: z.string().optional().default("default") } },
      { name: `${p}__scale_deployment`, description: `Scale a Kubernetes deployment (${this.connection.name})`, schema: { name: z.string(), namespace: z.string().optional().default("default"), replicas: z.number() } },
    ];
  }

  async executeTool(toolName, params) {
    const action = toolName.split("__").pop();
    const ns = params.namespace || "default";
    try {
      switch (action) {
        case "list_pods": {
          const q = params.label ? `?labelSelector=${encodeURIComponent(params.label)}` : "";
          const data = await this._fetch(`/api/v1/namespaces/${ns}/pods${q}`);
          return ok(data.items.map(p => ({ name: p.metadata.name, status: p.status.phase, restarts: p.status.containerStatuses?.[0]?.restartCount || 0, node: p.spec.nodeName, age: p.metadata.creationTimestamp })));
        }
        case "list_deployments": {
          const data = await this._fetch(`/apis/apps/v1/namespaces/${ns}/deployments`);
          return ok(data.items.map(d => ({ name: d.metadata.name, replicas: d.status.readyReplicas + "/" + d.spec.replicas, image: d.spec.template.spec.containers[0]?.image, age: d.metadata.creationTimestamp })));
        }
        case "list_services": {
          const data = await this._fetch(`/api/v1/namespaces/${ns}/services`);
          return ok(data.items.map(s => ({ name: s.metadata.name, type: s.spec.type, clusterIP: s.spec.clusterIP, ports: s.spec.ports?.map(p => `${p.port}/${p.protocol}`) })));
        }
        case "get_pod_logs": {
          const base = this.config.apiServer.replace(/\/+$/, "");
          const res = await fetch(`${base}/api/v1/namespaces/${ns}/pods/${params.pod}/log?tailLines=${params.lines || 100}`, {
            headers: { Authorization: `Bearer ${this.config.token}` },
          });
          return ok({ pod: params.pod, logs: await res.text() });
        }
        case "list_namespaces": {
          const data = await this._fetch("/api/v1/namespaces");
          return ok(data.items.map(n => ({ name: n.metadata.name, status: n.status.phase })));
        }
        case "list_events": {
          const data = await this._fetch(`/api/v1/namespaces/${ns}/events?limit=30`);
          return ok(data.items.slice(-30).map(e => ({ type: e.type, reason: e.reason, message: e.message, object: e.involvedObject.name, time: e.lastTimestamp })));
        }
        case "scale_deployment": {
          const base = this.config.apiServer.replace(/\/+$/, "");
          const res = await fetch(`${base}/apis/apps/v1/namespaces/${ns}/deployments/${params.name}/scale`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ apiVersion: "autoscaling/v1", kind: "Scale", metadata: { name: params.name, namespace: ns }, spec: { replicas: params.replicas } }),
          });
          if (!res.ok) throw new Error(`Scale failed: ${res.status}`);
          return ok({ deployment: params.name, replicas: params.replicas, status: "scaled" });
        }
        default: return err(`Unknown action: ${action}`);
      }
    } catch (e) { return err(e.message); }
  }
}
