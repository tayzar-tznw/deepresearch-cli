import path from "node:path";
import { makeClient } from "../api/client.js";
import { resolveAuth } from "../store/config.js";
import { saveArtifacts } from "../output/artifacts.js";
import { Logger } from "../output/logger.js";
import type { GlobalOpts } from "./types.js";

export interface FetchOpts extends GlobalOpts {
  out?: string;
  format?: "md" | "json" | "html";
  includeArtifacts?: boolean;
}

export async function fetchCmd(id: string, opts: FetchOpts): Promise<void> {
  const log = new Logger(opts);
  const auth = await resolveAuth();
  const client = makeClient(auth);
  const job = await client.get(id);
  if (job.status !== "completed") {
    log.warn(`job ${id} is in state \`${job.status}\` — fetching whatever outputs exist`);
  }
  const outDir = path.resolve(opts.out ?? "./research");
  const artifacts = await saveArtifacts(job, outDir, opts.format ?? "md");
  log.emit({
    id: job.id,
    state: job.status,
    out_dir: artifacts.outDir,
    report: artifacts.reportPath,
    report_chars: artifacts.reportChars,
    report_size_bytes: artifacts.reportSize,
    charts: artifacts.charts,
    images: artifacts.images,
    manifest: artifacts.manifestPath,
  });
}
