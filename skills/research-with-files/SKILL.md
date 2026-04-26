---
name: research-with-files
description: Run a Google Deep Research Max report grounded in specific local files (PDFs, CSVs, images, audio, video) and/or URLs the user provides. Use when the user attaches documents and asks to "analyze these and research...", "compare against the literature", "extend this dataset with external sources", "fact-check this paper", or "what does the web say about the trends in this CSV". Also use when the user wants to do private-only research with --no-web.
allowed-tools: Bash(gdr:*), Read, Glob
---

# Research with files (grounded / multimodal)

Use this skill when the user wants Deep Research Max to ground its analysis in specific documents or URLs they provide, rather than purely open-web search.

## Workflow

1. **Resolve the files.** If the user gave a glob, expand it with `Glob`. If they gave a directory, list the files. If they gave specific paths, just use them.

2. **Build the command WITH `--plan` by default.** File-grounded research benefits even more from the plan-review step (it reveals what the agent extracted from the docs and how it'll combine that with web sources). Repeat `--file <path>` for each local file and `--url <url>` for each web URL.

   ```bash
   gdr start "<research prompt that references the attached files>" \
     --plan \
     --file path/to/paper.pdf \
     --file path/to/data.csv \
     --url https://example.com/related-work \
     --name "<short-label>" \
     --confirm-cost \
     --json
   ```

   - To do **private-only** research (no open-web search), add `--no-web`.
   - Supported file types: PDF, CSV, TXT, MD, JSON, PNG/JPG/WebP, MP3/WAV, MP4.
   - Skip `--plan` only if the user explicitly said "just run it" / "no plan".

   > **Under the hood (preview workaround):** Deep Research Max ignores `collaborative_planning` in the current preview, so `gdr` auto-routes the plan turn to Standard tier (~$1.22, ~30 sec). The JSON response includes `plan_auto_standard: true` and `intended_agent: "deep-research-max-preview-04-2026"`. The actual research run after `gdr refine` automatically uses Max via the preserved `intendedAgent`. See the `deep-research` skill for the full explanation.

3. **Wait for the plan, present it, get approval/refinement** — same as in the `deep-research` skill (steps 3–5):

   ```bash
   gdr wait <id> --json                                      # ~30 sec, exits when state=completed
   gdr fetch <id> --out ./plans/<label>                      # read & present plan to user
   gdr refine <id> --approve   # OR: gdr refine <id> "<refinement>"
   #   → returns NEW id, agent=deep-research-max-preview-04-2026, ~$4.80
   ```

4. **Wait + fetch the refined run** as in `deep-research` (10–60 min on Max):

   ```bash
   gdr wait <new-id> --json
   gdr fetch <new-id> --out ./research/<label> --format md --json
   ```

5. **Read** the markdown at the printed `report` path and summarize.

## Tips

- For very large files (>50 MB), the request body may exceed API limits. Suggest the user pre-extract or summarize before attaching.
- If the user wants Max to call out to their own corpus or MCP server, that's a separate tool config — not yet wired in `gdr` v1. Tell them to use the official API directly for that.
- Use `--plan` (collaborative planning) when the user's intent for how to combine the files with web research is unclear.

## Don't

- Don't paste the file contents into the prompt argument — pass them via `--file` so the API ingests them as native multimodal content.
- Don't combine many unrelated files in one job; split into focused jobs so each report stays usable.
