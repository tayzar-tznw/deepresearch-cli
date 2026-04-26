import pc from "picocolors";
import ora, { type Ora } from "ora";
import { redact } from "../util/redact.js";

export interface LoggerOpts {
  json?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

export class Logger {
  private readonly opts: LoggerOpts;
  constructor(opts: LoggerOpts = {}) {
    this.opts = opts;
    if (opts.noColor) {
      process.env["FORCE_COLOR"] = "0";
      process.env["NO_COLOR"] = "1";
    }
  }
  get isJson(): boolean {
    return Boolean(this.opts.json);
  }
  info(msg: string): void {
    if (this.opts.quiet || this.opts.json) return;
    process.stderr.write(`${redact(msg)}\n`);
  }
  warn(msg: string): void {
    if (this.opts.json) return;
    process.stderr.write(`${pc.yellow("warn")} ${redact(msg)}\n`);
  }
  error(msg: string): void {
    if (this.opts.json) {
      process.stdout.write(`${JSON.stringify({ error: redact(msg) })}\n`);
      return;
    }
    process.stderr.write(`${pc.red("error")} ${redact(msg)}\n`);
  }
  success(msg: string): void {
    if (this.opts.quiet || this.opts.json) return;
    process.stderr.write(`${pc.green("ok")} ${redact(msg)}\n`);
  }
  emit(payload: unknown): void {
    if (this.opts.json) {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return;
    }
    if (this.opts.quiet) return;
    process.stdout.write(`${redact(stringifyHuman(payload))}\n`);
  }
  spinner(text: string): Ora | null {
    if (this.opts.json || this.opts.quiet || !process.stderr.isTTY) return null;
    return ora({ text, stream: process.stderr }).start();
  }
  dim(text: string): string {
    return pc.dim(text);
  }
  bold(text: string): string {
    return pc.bold(text);
  }
}

function stringifyHuman(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      lines.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
    return lines.join("\n");
  }
  return String(payload);
}
