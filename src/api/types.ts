import { z } from "zod";

export const StatusSchema = z.enum([
  "in_progress",
  "requires_action",
  "completed",
  "failed",
  "cancelled",
  "incomplete",
]);
export type InteractionStatus = z.infer<typeof StatusSchema>;

export const TextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});
export const ImageContentSchema = z.object({
  type: z.literal("image"),
  data: z.string().optional(),
  uri: z.string().optional(),
  mime_type: z.string().optional(),
});
export const DocumentContentSchema = z.object({
  type: z.literal("document"),
  data: z.string().optional(),
  uri: z.string().optional(),
  mime_type: z.string().optional(),
});
export const ThoughtContentSchema = z.object({
  type: z.literal("thought"),
  text: z.string().optional(),
});

export const OutputContentSchema = z.union([
  TextContentSchema,
  ImageContentSchema,
  DocumentContentSchema,
  ThoughtContentSchema,
  z.object({ type: z.string() }).passthrough(),
]);
export type OutputContent = z.infer<typeof OutputContentSchema>;

export const InteractionResponseSchema = z
  .object({
    id: z.string(),
    status: StatusSchema,
    created: z.string().optional(),
    updated: z.string().optional(),
    agent: z.string().optional(),
    outputs: z.array(OutputContentSchema).optional(),
    error: z
      .object({ message: z.string().optional(), code: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type InteractionResponse = z.infer<typeof InteractionResponseSchema>;

export function extractText(outputs: OutputContent[] | undefined): string {
  if (!outputs || outputs.length === 0) return "";
  const texts: string[] = [];
  for (const out of outputs) {
    if (out.type === "text" && "text" in out && typeof out.text === "string") texts.push(out.text);
  }
  return texts.join("\n\n");
}

export interface FileAttachment {
  path: string;
  mimeType?: string;
}
