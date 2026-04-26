---
name: deep-research
description: Run an in-depth multi-source research report (10-60 min, ~$4.80) using Google Deep Research Max (Gemini 3.1 Pro). Use when the user asks for a "deep dive", "comprehensive report", "literature review", "due diligence", "market analysis", "state of the art", "competitive analysis", or any task requiring synthesis across many web sources. NOT for quick lookups - use WebSearch for those. Defaults to Max tier; pass --standard to use the cheaper Standard tier ($1.22, 5-10 min).
allowed-tools: Bash(gdr:*), Read
---

# Deep Research (Google Deep Research Max)

Use this skill to delegate long-form, multi-source research to Google's Deep Research Max agent. The agent runs autonomously for 10-60 minutes, executing ~160 web searches and synthesizing a report with native charts.

## When to use

- "Do a deep dive on X"
- "Comprehensive report on Y"
- "Literature review of Z"
- "Due diligence on company / technology / regulation"
- "Competitive analysis"
- "State of the art in <field> as of <date>"

## When NOT to use

- Quick factual lookups (use `WebSearch`)
- Reading a single page (use `WebFetch`)
- Answering a question whose scope fits in one prompt

## Workflow

1. **Confirm cost on first use this session.** Max-tier runs cost ~$4.80 each. Tell the user the estimated cost and ask for confirmation. If they want to keep it cheaper, suggest `--standard` (~$1.22, less depth).

2. **Pick a short label** for the job (1-3 words, snake-case-ish) so the user can refer back to it later via the `research-status` skill.

3. **Fire-and-forget the job.** Do NOT use `gdr run` (which blocks for up to an hour). Instead:

   ```bash
   gdr start "<full research prompt>" --name "<label>" --confirm-cost --json
   ```

   The output is a JSON line with `id`, `state`, `cost_estimate`, and `next` fields.

4. **Wait in a separate command.** This way a session restart can resume via the `research-status` skill instead of losing the job.

   ```bash
   gdr wait <id> --json
   ```

   **Or stream the agent's thinking live** if the user wants to watch progress (or asks "show me what it's doing"):

   ```bash
   gdr follow <id>
   ```

   This emits Gemini's `thought_summary` deltas (dim/italic on stderr) and the report text deltas (normal on stdout) as they arrive via SSE. Add `--tool-calls` to also surface search queries and URL fetches. Use `gdr follow` instead of `gdr wait` when the user wants visibility into the reasoning process.

5. **Fetch the report** when `state` is `completed`:

   ```bash
   gdr fetch <id> --out ./research/<label> --format md --json
   ```

6. **Read the markdown** from the printed `report` path, summarize the key findings in your reply, and cite the file path so the user can open it.

## Flags worth knowing

- `--standard` — cheaper, faster, less depth (~$1.22, 5-10 min)
- `--plan` — collaborative planning: agent returns a research plan first; you can refine it before execution. Use when the user's prompt is ambiguous.
- `--no-web` — disable web search (only useful with `--file` / `--url` for grounded-only research)
- `--file <path>` — repeatable, attach local PDFs/CSVs/images for grounding (use `research-with-files` skill instead if files are central)
- `--url <url>` — repeatable, ground in specific URLs
- `gdr follow <id>` — stream thoughts + content live (SSE). `--no-thoughts` hides reasoning, `--tool-calls` shows search queries.
- `gdr run "<query>" --stream` — synchronous start + stream in one command (good for short interactive sessions; avoid for jobs > 10 min)

## If the job fails or times out

- Exit code 5 means the local poll timed out; the job is still running server-side. Re-run `gdr wait <id>` to resume.
- Exit code 6 means the job ended in `failed`/`cancelled`/`incomplete`. Inspect with `gdr status <id> --json` for the error message.

## Don't

- Don't pipe the report into your reply context — it can be 50k+ tokens. Always use `Read` on a chunk and summarize.
- Don't shell out to `gdr` without `--json` in scripted contexts; the human-readable output is for terminal use.
