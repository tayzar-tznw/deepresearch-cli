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

## Workflow — DEFAULT to collaborative planning (`--plan`)

For Max-tier runs, **always use `--plan` by default** so the user gets to review the agent's proposed angle before ~10–60 min of compute kicks off. Skip `--plan` only when one of these is true: (a) the user explicitly says "skip planning" / "just run it" / "no plan", (b) the user supplied a tight, narrowly-scoped brief that leaves no real planning ambiguity, or (c) you're using `--standard` for a quick lookup.

> **How `--plan` actually works under the hood (preview limitation):** Deep Research **Max** silently ignores `collaborative_planning: true` in the current Gemini preview (verified 2026-04-26 — it accepts the flag but runs the full report anyway). To work around this, `gdr` **automatically routes the plan turn to Standard tier** (~$0.30, ~30 sec) when you pass `--plan` with default Max. The user's intended Max tier is preserved on the job record so `gdr refine` runs the actual research on Max as expected. You'll see `plan_auto_standard: true` and `intended_agent` in the JSON output. To force Max for the plan turn anyway (it'll skip the plan and just run the full report), pass `--plan-tier=max`.

### Step-by-step

1. **Pick a short label** for the job (1–3 words, snake-case-ish) so the user can refer back via the `research-status` skill.

2. **Start the planning phase.** Fire-and-forget — do NOT use `gdr run` (which blocks for up to an hour):

   ```bash
   gdr start "<full research prompt>" --plan --name "<label>" --confirm-cost --json
   ```

   The JSON response will include `plan_auto_standard: true` and `intended_agent: "deep-research-max-preview-04-2026"` — that's expected (the workaround for the Max preview gap). Cost shown will be ~$1.22 (Standard for the plan turn), not $4.80.

3. **Wait for the plan** (~30–90 sec — the Standard plan turn is fast):

   ```bash
   gdr wait <id> --json
   ```

   Plan completes with `state: completed`. (You may also see `requires_action` if/when Google ships native Max support — `gdr wait` exits on either.)

4. **Fetch and read the proposed plan**, then PRESENT IT TO THE USER:

   ```bash
   gdr fetch <id> --out ./plans/<label> --format md --json
   ```

   `Read` the markdown at the printed `report` path — the plan is short (~1 KB, 5–10 numbered steps under "Research Plan:"). Summarize the plan's structure to the user (what areas it'll investigate, what sources, what scope) and explicitly ask:

   > "Here's the proposed research plan: [summary]. Want me to **approve as-is** (run on Max, ~$4.80, 10–60 min), or should I **refine it**? (e.g., add a topic, drop a section, narrow the date range, swap sources, change the angle)"

   Wait for their answer before proceeding.

5. **Approve or refine** based on their reply. The refine call automatically uses the user's intended Max tier (carried via `intendedAgent` on the parent job — you don't have to specify):

   ```bash
   # User said "looks good", "go ahead", "approve", etc.:
   gdr refine <id> --approve --confirm-cost --json

   # User asked for changes:
   gdr refine <id> "Also include vendor X. Skip the historical timeline. Focus on 2025+." --confirm-cost --json
   ```

   Both return a NEW id with `agent: "deep-research-max-preview-04-2026"` and `cost_estimate: $4.80`. Use that new id for the next steps.

6. **Wait for the actual research run** (10–60 min on Max). Two options — pick based on whether the user wants visibility:

   ```bash
   # Quietest — just block until done
   gdr wait <new-id> --json

   # OR stream Gemini's thinking + report text live (when user wants to watch)
   gdr follow <new-id>             # add --tool-calls to also surface search queries
   ```

7. **Fetch the final report**:

   ```bash
   gdr fetch <new-id> --out ./research/<label> --format md --json
   ```

8. **Read the markdown** from the printed `report` path, summarize the key findings in your reply, and cite the file path so the user can open it.

### Skipping the planning step

If the user has been explicit ("just run it", "no plan needed", or gave you a single tightly-scoped question), drop steps 3–5 and run `gdr start "<prompt>" --name "<label>" --confirm-cost --json` directly, then jump to step 6.

### Follow-up questions on a finished report

`gdr refine` also works on any **completed** job. After step 8, if the user asks a follow-up ("expand section 3", "find newer sources", "compare X to Y from this report"), use:

```bash
gdr refine <completed-id> "<follow-up question>" --confirm-cost --json
```

The continuation inherits the full prior context via `previous_interaction_id`, so the agent doesn't re-do work.

## Flags worth knowing

- `--standard` — cheaper, faster, less depth (~$1.22, 5-10 min)
- `--plan` — collaborative planning (see above)
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
