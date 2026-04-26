import { promises as fs } from "node:fs";
import path from "node:path";
import { extractText, type InteractionResponse, type OutputContent } from "../api/types.js";
import { redact } from "../util/redact.js";

export interface SavedArtifacts {
  outDir: string;
  reportPath?: string;
  manifestPath: string;
  charts: string[];
  images: string[];
  reportSize: number;
  reportChars: number;
}

export async function saveArtifacts(
  job: InteractionResponse,
  outDir: string,
  format: "md" | "json" | "html" = "md",
): Promise<SavedArtifacts> {
  await fs.mkdir(outDir, { recursive: true });
  const charts: string[] = [];
  const images: string[] = [];
  let chartIndex = 0;
  let imageIndex = 0;

  for (const out of job.outputs ?? []) {
    if (out.type === "image") {
      const filename = await writeImage(out, outDir, imageIndex++);
      if (filename) images.push(filename);
      continue;
    }
    if (looksLikeChartHtml(out)) {
      const filename = await writeChart(out, outDir, chartIndex++);
      if (filename) charts.push(filename);
    }
  }

  let reportPath: string | undefined;
  let reportSize = 0;
  let reportChars = 0;
  const text = redact(extractText(job.outputs));
  if (text.length > 0) {
    const ext = format === "json" ? "json" : format === "html" ? "html" : "md";
    reportPath = path.join(outDir, `report.${ext}`);
    const body =
      format === "json"
        ? JSON.stringify({ id: job.id, status: job.status, outputs: job.outputs }, null, 2)
        : format === "html"
          ? `<!doctype html><meta charset="utf-8"><title>${escapeHtml(job.id)}</title><pre>${escapeHtml(text)}</pre>`
          : text;
    await fs.writeFile(reportPath, body);
    const stat = await fs.stat(reportPath);
    reportSize = stat.size;
    reportChars = body.length;
  }

  const manifestPath = path.join(outDir, "outputs.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        id: job.id,
        status: job.status,
        agent: job.agent,
        report: reportPath ? path.basename(reportPath) : null,
        charts,
        images,
      },
      null,
      2,
    ),
  );

  return { outDir, reportPath, manifestPath, charts, images, reportSize, reportChars };
}

function looksLikeChartHtml(out: OutputContent): out is OutputContent & { html?: string } {
  if (out.type === "html") return true;
  const anyOut = out as Record<string, unknown>;
  if (typeof anyOut["html"] === "string") return true;
  if (out.type === "text" && "text" in out && typeof (out as { text: string }).text === "string") {
    const t = (out as { text: string }).text;
    if (t.startsWith("<!doctype") || t.startsWith("<html") || t.startsWith("<svg")) return true;
  }
  return false;
}

async function writeChart(out: OutputContent, outDir: string, index: number): Promise<string | null> {
  const anyOut = out as Record<string, unknown>;
  const html = (anyOut["html"] as string | undefined) ?? (anyOut["text"] as string | undefined);
  if (!html) return null;
  const filename = `chart-${index}.html`;
  await fs.writeFile(path.join(outDir, filename), html);
  return filename;
}

async function writeImage(out: OutputContent, outDir: string, index: number): Promise<string | null> {
  const anyOut = out as Record<string, unknown>;
  const data = anyOut["data"] as string | undefined;
  if (!data) return null;
  const mime = (anyOut["mime_type"] as string | undefined) ?? "image/png";
  const ext = mime.split("/")[1] ?? "png";
  const filename = `image-${index}.${ext}`;
  await fs.writeFile(path.join(outDir, filename), Buffer.from(data, "base64"));
  return filename;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
