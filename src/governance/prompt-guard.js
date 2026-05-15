/**
 * Prompt Guard — Detects prompt injection, jailbreak attempts, and system prompt leaks.
 * 
 * Three detection layers:
 *   1. Pattern-based — known injection signatures
 *   2. Heuristic — structural analysis (role switches, encoding tricks)
 *   3. Output guard — detect system prompt leakage in responses
 */

// ─── Injection Patterns ──────────────────────────────────────────────────────

const INJECTION_PATTERNS = [
  // Direct instruction override
  { id: "ignore-instructions", severity: "critical",
    regex: /ignore\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions|prompts|rules|directives|guidelines)/i,
    name: "Ignore Previous Instructions" },
  { id: "new-instructions", severity: "critical",
    regex: /(?:new|updated|revised|real|actual|true)\s+(?:instructions|system\s+prompt|rules|directives)\s*[:=]/i,
    name: "Instruction Override" },
  { id: "you-are-now", severity: "critical",
    regex: /you\s+are\s+now\s+(?:a|an|the|acting\s+as|pretending)/i,
    name: "Identity Override" },
  { id: "act-as", severity: "high",
    regex: /(?:act|behave|respond|pretend|roleplay)\s+(?:as\s+(?:if\s+)?(?:you\s+(?:are|were))?|like)\s+/i,
    name: "Role Hijack" },
  { id: "do-anything-now", severity: "critical",
    regex: /\b(?:DAN|do\s+anything\s+now|jailbreak|uncensored\s+mode|developer\s+mode|god\s+mode)\b/i,
    name: "DAN/Jailbreak Keyword" },

  // System prompt extraction
  { id: "reveal-prompt", severity: "critical",
    regex: /(?:reveal|show|display|print|output|repeat|tell\s+me|what\s+(?:is|are))\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions|rules|guidelines|directives)/i,
    name: "System Prompt Extraction" },
  { id: "begin-with", severity: "high",
    regex: /(?:begin|start)\s+(?:your\s+)?(?:response|reply|answer|output)\s+with\s*[:"']/i,
    name: "Forced Output Prefix" },
  { id: "repeat-above", severity: "critical",
    regex: /(?:repeat|echo|copy|recite)\s+(?:everything|all|the\s+text|what(?:'s|\s+is))\s+(?:above|before|prior)/i,
    name: "Repeat Above Attack" },

  // Encoding/Obfuscation attacks
  { id: "base64-inject", severity: "high",
    regex: /(?:decode|interpret|execute|run|eval)\s+(?:this\s+)?(?:base64|b64|encoded)/i,
    name: "Base64 Injection" },
  { id: "markdown-inject", severity: "medium",
    regex: /!\[.*?\]\(https?:\/\/[^\s)]*(?:callback|webhook|exfil|leak|steal)/i,
    name: "Markdown Exfiltration" },
  { id: "unicode-homoglyph", severity: "medium",
    regex: /[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/,
    name: "Hidden Unicode Characters" },

  // Privilege escalation
  { id: "sudo-admin", severity: "high",
    regex: /(?:sudo|admin|root|superuser|elevated)\s+(?:mode|access|privileges|permissions)/i,
    name: "Privilege Escalation" },
  { id: "override-safety", severity: "critical",
    regex: /(?:override|bypass|disable|turn\s+off|ignore|skip)\s+(?:safety|security|guardrails|filters|restrictions|limitations|content\s+policy)/i,
    name: "Safety Override" },

  // Multi-turn manipulation
  { id: "hypothetical", severity: "medium",
    regex: /(?:hypothetically|theoretically|in\s+a\s+fictional|for\s+(?:educational|research|academic)\s+purposes)/i,
    name: "Hypothetical Framing" },
  { id: "end-session", severity: "high",
    regex: /(?:<\/system>|<\|endoftext\|>|<\|im_end\|>|\[INST\]|\[\/INST\]|<<SYS>>)/i,
    name: "Token Boundary Injection" },

  // Tool-specific injections
  { id: "sql-in-prompt", severity: "high",
    regex: /(?:;\s*DROP\s+TABLE|UNION\s+SELECT|OR\s+1\s*=\s*1|'\s*OR\s*'|--\s*$)/i,
    name: "SQL Injection in Prompt" },
  { id: "command-inject", severity: "critical",
    regex: /(?:;\s*(?:rm|curl|wget|nc|bash|sh|python|node)\s|`[^`]*`|\$\([^)]*\))/i,
    name: "Command Injection" },
];

// ─── Output Leak Patterns ────────────────────────────────────────────────────

const LEAK_PATTERNS = [
  { id: "system-prompt-leak", severity: "critical",
    regex: /(?:system\s+prompt|my\s+instructions\s+(?:are|say)|I\s+was\s+(?:told|instructed|programmed)\s+to)/i,
    name: "System Prompt Leak" },
  { id: "role-leak", severity: "high",
    regex: /(?:as\s+(?:an?\s+)?AI\s+(?:language\s+)?model,?\s+I\s+(?:was|am)\s+(?:instructed|configured|set\s+up))/i,
    name: "AI Role Configuration Leak" },
];

// ─── Heuristic Checks ───────────────────────────────────────────────────────

function heuristicAnalysis(text) {
  const findings = [];

  // Excessive special characters (obfuscation attempt)
  const specialRatio = (text.match(/[^\w\s]/g) || []).length / Math.max(text.length, 1);
  if (specialRatio > 0.4 && text.length > 50) {
    findings.push({ id: "high-special-chars", name: "Excessive Special Characters", severity: "medium",
      detail: `${(specialRatio * 100).toFixed(0)}% special characters` });
  }

  // Very long input (potential context stuffing)
  if (text.length > 10000) {
    findings.push({ id: "context-stuffing", name: "Potential Context Stuffing", severity: "medium",
      detail: `${text.length} characters` });
  }

  // Multiple language switches (multi-lingual injection)
  const langBlocks = text.split(/\n{2,}/).filter(b => b.trim().length > 20);
  if (langBlocks.length > 5) {
    const hasEnglish = langBlocks.some(b => /^[a-zA-Z\s.,!?]+$/.test(b.trim().substring(0, 50)));
    const hasNonLatin = langBlocks.some(b => /[^\x00-\x7F]/.test(b.substring(0, 50)));
    if (hasEnglish && hasNonLatin) {
      findings.push({ id: "multi-lang-inject", name: "Multi-Language Injection", severity: "medium",
        detail: "Mixed language blocks detected" });
    }
  }

  // Repeated characters (bypass attempt)
  if (/(.)\1{20,}/.test(text)) {
    findings.push({ id: "char-repetition", name: "Character Repetition Attack", severity: "low",
      detail: "20+ repeated characters" });
  }

  return findings;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Scan input text for prompt injection attempts.
 * @returns {{ safe: boolean, findings: array, score: number }}
 *   score: 0-100 (0 = safe, 100 = definite injection)
 */
export function scanInput(text) {
  if (!text || typeof text !== "string") return { safe: true, findings: [], score: 0 };

  const findings = [];

  // Pattern matching
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.regex.test(text)) {
      findings.push({
        id: pattern.id,
        name: pattern.name,
        severity: pattern.severity,
        type: "pattern",
      });
    }
  }

  // Heuristic analysis
  findings.push(...heuristicAnalysis(text));

  // Calculate risk score
  const score = calculateScore(findings);

  // Any critical finding = unsafe
  const hasCritical = findings.some(f => f.severity === "critical");

  return {
    safe: !hasCritical && score < 40,
    findings,
    score,
  };
}

/**
 * Scan output text for system prompt leakage.
 */
export function scanOutput(text) {
  if (!text || typeof text !== "string") return { safe: true, findings: [], score: 0 };

  const findings = [];
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.regex.test(text)) {
      findings.push({ id: pattern.id, name: pattern.name, severity: pattern.severity, type: "leak" });
    }
  }

  const score = calculateScore(findings);
  return { safe: score < 30, findings, score };
}

/**
 * Deep scan — check all string values in an args object.
 */
export function scanArgs(args) {
  if (!args || typeof args !== "object") return { safe: true, findings: [], score: 0 };

  const allFindings = [];
  function walk(val) {
    if (typeof val === "string") {
      const result = scanInput(val);
      allFindings.push(...result.findings);
    } else if (Array.isArray(val)) {
      val.forEach(walk);
    } else if (val && typeof val === "object") {
      Object.values(val).forEach(walk);
    }
  }
  walk(args);

  const score = calculateScore(allFindings);
  return { safe: score < 40, findings: allFindings, score };
}

function calculateScore(findings) {
  let score = 0;
  for (const f of findings) {
    switch (f.severity) {
      case "critical": score += 35; break;
      case "high":     score += 20; break;
      case "medium":   score += 10; break;
      case "low":      score += 5;  break;
    }
  }
  return Math.min(100, score);
}

export { INJECTION_PATTERNS, LEAK_PATTERNS };
