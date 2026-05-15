/**
 * Snayu Plugin Registry
 *
 * Allows enterprise and third-party packages to extend Snayu
 * without modifying the OSS core. Plugins register hooks that
 * are called at defined points in the governance pipeline.
 *
 * Usage (enterprise package):
 *   import { registerPlugin } from '@arijitkb22/snayu/src/core/plugin-registry.js';
 *   registerPlugin({
 *     name: 'snayu-enterprise',
 *     version: '1.0.0',
 *     hooks: {
 *       afterAudit:    async (entry) => { ... },   // called after every tool call is audited
 *       beforeExecute: async (tool, args, meta) => { ... }, // called before tool execution
 *       afterExecute:  async (tool, result, meta) => { ... }, // called after tool execution
 *       onAlert:       async (alert) => { ... },   // called when a governance alert fires
 *       onStats:       async (stats) => { ... },   // called when stats are updated
 *     }
 *   });
 */

const plugins = [];

/**
 * Register a plugin. Call this once at startup from your enterprise package.
 * @param {{ name: string, version?: string, hooks: Record<string, Function> }} plugin
 */
export function registerPlugin(plugin) {
  if (!plugin?.name) throw new Error("Plugin must have a name");
  if (!plugin?.hooks) throw new Error("Plugin must define hooks");
  const existing = plugins.findIndex((p) => p.name === plugin.name);
  if (existing >= 0) {
    plugins[existing] = plugin; // allow re-registration (hot reload)
  } else {
    plugins.push(plugin);
  }
  console.log(`[snayu] Plugin registered: ${plugin.name}${plugin.version ? ` v${plugin.version}` : ""}`);
}

/**
 * Unregister a plugin by name.
 * @param {string} name
 */
export function unregisterPlugin(name) {
  const idx = plugins.findIndex((p) => p.name === name);
  if (idx >= 0) plugins.splice(idx, 1);
}

/**
 * Get all plugins that implement a specific hook.
 * @param {string} hook
 * @returns {Array}
 */
export function getPlugins(hook) {
  return plugins.filter((p) => typeof p.hooks?.[hook] === "function");
}

/**
 * Call a hook on all registered plugins that implement it.
 * Errors in plugins are caught and logged — they never crash the core.
 * @param {string} hook  - hook name e.g. "afterAudit"
 * @param {...any} args  - arguments passed to the hook
 */
export async function callHook(hook, ...args) {
  const matched = getPlugins(hook);
  for (const plugin of matched) {
    try {
      await plugin.hooks[hook](...args);
    } catch (err) {
      console.error(`[snayu] Plugin "${plugin.name}" hook "${hook}" threw:`, err.message);
    }
  }
}

/**
 * Call a hook that can BLOCK execution by returning { block: true, reason: "..." }.
 * First plugin that returns a block wins — subsequent plugins are not called.
 * Used for beforeExecute to allow enterprise plugins to gate tool calls.
 *
 * @param {string} hook
 * @param {...any} args
 * @returns {Promise<{ block: boolean, reason?: string } | null>}
 */
export async function callHookWithVeto(hook, ...args) {
  const matched = getPlugins(hook);
  for (const plugin of matched) {
    try {
      const result = await plugin.hooks[hook](...args);
      if (result?.block === true) {
        return { block: true, reason: result.reason || `Blocked by plugin: ${plugin.name}` };
      }
    } catch (err) {
      console.error(`[snayu] Plugin "${plugin.name}" hook "${hook}" threw:`, err.message);
    }
  }
  return { block: false };
}

/**
 * List all registered plugins (for dashboard / diagnostics).
 * @returns {Array<{ name: string, version: string, hooks: string[] }>}
 */
export function listPlugins() {
  return plugins.map((p) => ({
    name: p.name,
    version: p.version ?? "unknown",
    hooks: Object.keys(p.hooks ?? {}),
  }));
}
