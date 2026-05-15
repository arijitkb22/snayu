/**
 * Guardrails — Scan inputs & outputs for secrets/PII, redact or block.
 */
import { PATTERNS } from "./patterns.js";

/**
 * Scan a string for pattern matches.
 * Returns array of { patternId, name, severity, category, match, index }.
 */
export function scan(text) {
  if (!text || typeof text !== "string") return [];
  const findings = [];

  for (const pattern of PATTERNS) {
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const matched = m[1] || m[0];

      // Context check — some patterns only fire near a context keyword
      if (pattern.context) {
        const region = text.substring(Math.max(0, m.index - 80), m.index + m[0].length + 80);
        if (!pattern.context.test(region)) continue;
      }

      // Validation check — e.g. Luhn for credit cards
      if (pattern.validate && !pattern.validate(matched)) continue;

      findings.push({
        patternId: pattern.id,
        name: pattern.name,
        severity: pattern.severity,
        category: pattern.category,
        match: matched,
        index: m.index,
      });
    }
  }
  return findings;
}

/**
 * Redact all detected patterns in a string.
 * Returns { redacted: string, findings: array }.
 */
export function redact(text) {
  if (!text || typeof text !== "string") return { redacted: text, findings: [] };

  const findings = scan(text);
  if (findings.length === 0) return { redacted: text, findings: [] };

  let result = text;
  // Sort by index descending so replacements don't shift earlier indices
  const sorted = [...findings].sort((a, b) => b.index - a.index);

  for (const f of sorted) {
    const pattern = PATTERNS.find(p => p.id === f.patternId);
    if (pattern) {
      result = result.replace(f.match, pattern.mask);
    }
  }
  return { redacted: result, findings };
}

/**
 * Deep-scan an object (tool args or results). Scans all string values recursively.
 * Returns { clean: object, findings: array, redacted: boolean }.
 */
export function scanObject(obj, options = {}) {
  const { mode = "redact" } = options; // "redact" | "block" | "detect"
  const allFindings = [];

  function walk(val) {
    if (typeof val === "string") {
      const findings = scan(val);
      if (findings.length > 0) {
        allFindings.push(...findings);
        if (mode === "redact") {
          return redact(val).redacted;
        }
      }
      return val;
    }
    if (Array.isArray(val)) return val.map(walk);
    if (val && typeof val === "object") {
      const out = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = walk(v);
      }
      return out;
    }
    return val;
  }

  const clean = walk(obj);
  const hasCritical = allFindings.some(f => f.severity === "critical");

  return {
    clean,
    findings: allFindings,
    redacted: allFindings.length > 0,
    blocked: mode === "block" && hasCritical,
  };
}

/**
 * Quick check — does text contain any critical secrets?
 */
export function hasCriticalSecrets(text) {
  return scan(text).some(f => f.severity === "critical" && f.category === "secret");
}
