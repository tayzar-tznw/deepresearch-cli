---
name: research-status
description: Check on or retrieve results from a previously-started Google Deep Research Max job. Use when the user asks "is my research done?", "did the deep research finish?", references a prior research task by name or topic, mentions a job ID like "dr-...", or returns to a session where research was kicked off earlier. Lists running and completed jobs from the local cache and fetches finished reports.
allowed-tools: Bash(gdr:*), Read
---

# Research status

Use this skill when the user asks about a research job that was started earlier — possibly in a previous session — and either wants its current state or its final report.

## Workflow

1. **List recent jobs** to find what the user is referring to:

   ```bash
   gdr list --json --limit 20
   ```

   The output includes `id`, `state`, `agent`, `query`, `label`, `costEstimateUsd`, `intendedAgent` (set when `--plan` auto-routed the plan turn to Standard), and ages.

2. **Match the user's intent** to a job using the `label` (set via `--name` when started), the `query` text, or the `id` if they pasted one. If multiple jobs match, ask the user which one. If none match, tell the user there are no matching jobs in the local cache (the cache is per-machine — jobs started on another machine won't appear).

   > If the matched job has `agent: "deep-research-preview-04-2026"` AND `intendedAgent: "deep-research-max-preview-04-2026"`, that's a **plan turn** (the user is mid-collaborative-planning workflow). Treat it as a plan, not a final report — fetching gives you a short "Research Plan:" markdown, and the user probably wants to either approve (`gdr refine <id> --approve`) or refine (`gdr refine <id> "<changes>"`) to kick off the actual Max-tier research.

3. **Get the latest server-side state**:

   ```bash
   gdr status <id> --json
   ```

4. **If `state` is `in_progress`** — tell the user it's still running and offer two ways to follow it:
   - `gdr wait <id> --json` (blocks until done; quietest)
   - `gdr follow <id>` (streams Gemini's thoughts + report text live via SSE; good if the user wants to watch progress or asks "what's it doing")

5. **If `state` is `completed`** — fetch and read the report:

   ```bash
   gdr fetch <id> --out ./research/<label-or-id> --format md --json
   ```

   Then `Read` the markdown file at the printed `report` path and summarize.

6. **If `state` is `failed` / `cancelled` / `incomplete`** — surface the `error` field and offer to re-run.

## Don't

- Don't kick off a new job from this skill — that's the `deep-research` skill's job.
- Don't assume `gdr list` is exhaustive. It only sees jobs created on this machine. If the user references a job not in the list, ask them for the `id`.
