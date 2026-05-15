/**
 * Detection Patterns — Secret & PII regex patterns for guardrails.
 * 
 * Each pattern has:
 *   - id: unique identifier
 *   - name: human-readable name
 *   - category: "secret" | "pii" | "sensitive"
 *   - regex: detection pattern
 *   - mask: replacement string (e.g. "***AWS_KEY***")
 *   - severity: "critical" | "high" | "medium" | "low"
 */

export const PATTERNS = [

  // ═══ AWS Secrets ═══
  { id: "aws-access-key", name: "AWS Access Key ID", category: "secret", severity: "critical",
    regex: /(?<![A-Z0-9])(AKIA[0-9A-Z]{16})(?![A-Z0-9])/g,
    mask: "***AWS_ACCESS_KEY***" },

  { id: "aws-secret-key", name: "AWS Secret Access Key", category: "secret", severity: "critical",
    regex: /(?<![A-Za-z0-9/+=])([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/g,
    mask: "***AWS_SECRET_KEY***",
    context: /aws_secret_access_key|secretaccesskey|secret.?key/i }, // only match near these contexts

  { id: "aws-session-token", name: "AWS Session Token", category: "secret", severity: "critical",
    regex: /(?:aws.?session.?token|x-amz-security-token)\s*[=:]\s*["']?([A-Za-z0-9/+=]{100,})/gi,
    mask: "***AWS_SESSION_TOKEN***" },

  // ═══ API Keys & Tokens ═══
  { id: "github-token", name: "GitHub Token", category: "secret", severity: "critical",
    regex: /\b(gh[ps]_[A-Za-z0-9_]{36,})\b/g,
    mask: "***GITHUB_TOKEN***" },

  { id: "github-fine-grained", name: "GitHub Fine-Grained Token", category: "secret", severity: "critical",
    regex: /\b(github_pat_[A-Za-z0-9_]{22,})\b/g,
    mask: "***GITHUB_PAT***" },

  { id: "slack-token", name: "Slack Token", category: "secret", severity: "critical",
    regex: /\b(xox[bpras]-[0-9a-zA-Z-]{10,})\b/g,
    mask: "***SLACK_TOKEN***" },

  { id: "stripe-key", name: "Stripe Key", category: "secret", severity: "critical",
    regex: /\b(sk_(live|test)_[0-9a-zA-Z]{24,})\b/g,
    mask: "***STRIPE_KEY***" },

  { id: "stripe-publishable", name: "Stripe Publishable Key", category: "secret", severity: "medium",
    regex: /\b(pk_(live|test)_[0-9a-zA-Z]{24,})\b/g,
    mask: "***STRIPE_PK***" },

  { id: "openai-key", name: "OpenAI API Key", category: "secret", severity: "critical",
    regex: /\b(sk-[A-Za-z0-9]{32,})\b/g,
    mask: "***OPENAI_KEY***" },

  { id: "anthropic-key", name: "Anthropic API Key", category: "secret", severity: "critical",
    regex: /\b(sk-ant-[A-Za-z0-9-]{32,})\b/g,
    mask: "***ANTHROPIC_KEY***" },

  { id: "sendgrid-key", name: "SendGrid API Key", category: "secret", severity: "critical",
    regex: /\b(SG\.[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{22,})\b/g,
    mask: "***SENDGRID_KEY***" },

  { id: "twilio-key", name: "Twilio API Key", category: "secret", severity: "critical",
    regex: /\b(SK[0-9a-fA-F]{32})\b/g,
    mask: "***TWILIO_KEY***" },

  { id: "mailgun-key", name: "Mailgun API Key", category: "secret", severity: "high",
    regex: /\b(key-[0-9a-zA-Z]{32})\b/g,
    mask: "***MAILGUN_KEY***" },

  { id: "jwt", name: "JSON Web Token", category: "secret", severity: "high",
    regex: /\b(eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]{10,})\b/g,
    mask: "***JWT***" },

  { id: "bearer-token", name: "Bearer Token", category: "secret", severity: "high",
    regex: /[Bb]earer\s+([A-Za-z0-9\-._~+/]+=*)/g,
    mask: "Bearer ***REDACTED***" },

  { id: "basic-auth", name: "Basic Auth Header", category: "secret", severity: "high",
    regex: /[Bb]asic\s+([A-Za-z0-9+/]+=*)/g,
    mask: "Basic ***REDACTED***" },

  { id: "private-key", name: "Private Key", category: "secret", severity: "critical",
    regex: /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/g,
    mask: "***PRIVATE_KEY***" },

  { id: "generic-api-key", name: "Generic API Key Pattern", category: "secret", severity: "medium",
    regex: /(?:api[_-]?key|apikey|api[_-]?secret|api[_-]?token)\s*[=:]\s*["']?([A-Za-z0-9\-._]{20,})["']?/gi,
    mask: "***API_KEY***" },

  { id: "generic-password", name: "Password in String", category: "secret", severity: "high",
    regex: /(?:password|passwd|pwd)\s*[=:]\s*["']([^"']{4,})["']/gi,
    mask: "***PASSWORD***" },

  { id: "connection-string", name: "Database Connection String", category: "secret", severity: "critical",
    regex: /(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi,
    mask: "***CONNECTION_STRING***" },

  // ═══ PII Patterns ═══
  { id: "ssn", name: "US Social Security Number", category: "pii", severity: "critical",
    regex: /\b(\d{3}-\d{2}-\d{4})\b/g,
    mask: "***SSN***" },

  { id: "email", name: "Email Address", category: "pii", severity: "medium",
    regex: /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
    mask: "***EMAIL***" },

  { id: "phone-us", name: "US Phone Number", category: "pii", severity: "medium",
    regex: /\b(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g,
    mask: "***PHONE***" },

  { id: "phone-intl", name: "International Phone", category: "pii", severity: "medium",
    regex: /\b(\+\d{1,3}[-.\s]?\d{4,14})\b/g,
    mask: "***PHONE***" },

  { id: "credit-card", name: "Credit Card Number", category: "pii", severity: "critical",
    regex: /\b(\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4})\b/g,
    mask: "***CREDIT_CARD***",
    validate: (match) => luhnCheck(match.replace(/[-\s]/g, "")) },

  { id: "ip-address", name: "IPv4 Address", category: "sensitive", severity: "low",
    regex: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
    mask: "***IP***" },

  { id: "iban", name: "IBAN", category: "pii", severity: "high",
    regex: /\b([A-Z]{2}\d{2}[A-Z0-9]{4,30})\b/g,
    mask: "***IBAN***" },

  { id: "passport", name: "Passport Number", category: "pii", severity: "critical",
    regex: /(?:passport)\s*(?:no|number|#)?\s*[=:]\s*["']?([A-Z0-9]{6,12})["']?/gi,
    mask: "***PASSPORT***" },

  { id: "dob", name: "Date of Birth Pattern", category: "pii", severity: "high",
    regex: /(?:date.?of.?birth|dob|birth.?date)\s*[=:]\s*["']?(\d{1,4}[-/]\d{1,2}[-/]\d{1,4})["']?/gi,
    mask: "***DOB***" },

  // ═══ Infrastructure Sensitive ═══
  { id: "internal-ip", name: "Private/Internal IP Range", category: "sensitive", severity: "low",
    regex: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
    mask: "***INTERNAL_IP***" },

  { id: "aws-account-id", name: "AWS Account ID", category: "sensitive", severity: "medium",
    regex: /(?:account.?id|account)\s*[=:]\s*["']?(\d{12})["']?/gi,
    mask: "***AWS_ACCOUNT***" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function luhnCheck(num) {
  if (!/^\d{13,19}$/.test(num)) return false;
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = parseInt(num[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Get patterns by category.
 */
export function getPatternsByCategory(category) {
  return PATTERNS.filter(p => p.category === category);
}

/**
 * Get patterns by severity.
 */
export function getPatternsBySeverity(severity) {
  return PATTERNS.filter(p => p.severity === severity);
}
