---
name: research-with-files
description: Run a Google Deep Research Max report grounded in specific local files (PDFs, CSVs, images, audio, video) and/or URLs the user provides. Use when the user attaches documents and asks to "analyze these and research...", "compare against the literature", "extend this dataset with external sources", "fact-check this paper", or "what does the web say about the trends in this CSV". Also use when the user wants to do private-only research with --no-web.
allowed-tools: Bash(gdr:*), Read, Glob
---

# Research with files (grounded / multimodal)

Use this skill when the user wants Deep Research Max to ground its analysis in specific documents or URLs they provide, rather than purely open-web search.

## Workflow

1. **Resolve the files.** If the user gave a glob, expand it with `Glob`. If they gave a directory, list the files. If they gave specific paths, just use them.

2. **Confirm cost** on first use this session — Max with file inputs is still ~$4.80, plus token cost for the file contents (Max accepts up to ~1M input tokens including files).

3. **Build the command.** Repeat `--file <path>` for each local file and `--url <url>` for each web URL. Use `--name` to label.

   ```bash
   gdr start "<research prompt that references the attached files>" \
     --file path/to/paper.pdf \
     --file path/to/data.csv \
     --url https://example.com/related-work \
     --name "<short-label>" \
     --confirm-cost \
     --json
   ```

   - To do **private-only** research (no open-web search), add `--no-web`.
   - Supported file types: PDF, CSV, TXT, MD, JSON, PNG/JPG/WebP, MP3/WAV, MP4.

4. **Wait, then fetch** as in the `deep-research` skill:

   ```bash
   gdr wait <id> --json
   gdr fetch <id> --out ./research/<label> --format md --json
   ```

5. **Read** the markdown at the printed `report` path and summarize.

## Tips

- For very large files (>50 MB), the request body may exceed API limits. Suggest the user pre-extract or summarize before attaching.
- If the user wants Max to call out to their own corpus or MCP server, that's a separate tool config — not yet wired in `gdr` v1. Tell them to use the official API directly for that.
- Use `--plan` (collaborative planning) when the user's intent for how to combine the files with web research is unclear.

## Don't

- Don't paste the file contents into the prompt argument — pass them via `--file` so the API ingests them as native multimodal content.
- Don't combine many unrelated files in one job; split into focused jobs so each report stays usable.
