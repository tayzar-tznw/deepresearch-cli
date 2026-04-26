export interface RetryOpts {
  retries?: number;
  factor?: number;
  minTimeoutMs?: number;
  maxTimeoutMs?: number;
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const retries = opts.retries ?? 5;
  const factor = opts.factor ?? 2;
  const minMs = opts.minTimeoutMs ?? 1000;
  const maxMs = opts.maxTimeoutMs ?? 32_000;
  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (opts.shouldRetry && !opts.shouldRetry(err)) throw err;
      if (attempt === retries) break;
      const delay = Math.min(minMs * Math.pow(factor, attempt), maxMs);
      opts.onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
      attempt++;
    }
  }
  throw lastErr;
}

export function isRetryableHttpError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; code?: string };
  const status = e.status ?? e.statusCode;
  if (typeof status === "number") {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  if (e.code && /ECONN|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|UND_ERR/.test(e.code)) return true;
  return false;
}
