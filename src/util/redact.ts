const API_KEY_RE = /AIza[0-9A-Za-z_-]{35}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._-]{20,}/gi;

export function redact(input: string): string {
  return input.replace(API_KEY_RE, "AIza***REDACTED***").replace(BEARER_RE, "Bearer ***REDACTED***");
}

export function redactObject<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactObject(v)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /key|token|secret|authorization/i.test(k) && typeof v === "string" ? "***REDACTED***" : redactObject(v);
    }
    return out as T;
  }
  return value;
}
