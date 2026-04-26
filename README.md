# google-deep-research

CLI + Claude Code skills for **Google Deep Research Max** — the autonomous research agent on the Gemini Interactions API, backed by Gemini 3.1 Pro. Lets coding agents (Claude Code, Gemini CLI, Codex CLI, anything that can shell out) delegate long-form, multi-source research and get a markdown report back.

- **Default tier:** Deep Research **Max** (`deep-research-max-preview-04-2026`) — ~$4.80/run, 10–60 min, ~160 web searches, native charts.
- **Opt-out:** `--standard` for the lighter tier (~$1.22, 5–10 min).
- **No MCP server, no browser automation** — pure REST against the official API.

## Install

**Recommended (one command per piece):**

```bash
# 1. Install the CLI binary from the GitHub tarball URL.
#    (Use the tarball URL — NOT `github:tayzar-tznw/deepresearch-cli` — to bypass
#     npm's git-dep prep, which has a known protobufjs postinstall race on Node 22+.)
npm i -g https://github.com/tayzar-tznw/deepresearch-cli/tarball/main

# 2. Install the agent skills via the universal `skills` package manager
#    (auto-detects Claude Code, Cursor, Codex, Gemini CLI, OpenCode, Copilot,
#     Windsurf, and ~35 other agents you have installed)
npx skills add tayzar-tznw/deepresearch-cli

# 3. Verify
gdr doctor
```

> Once published to the npm registry, the binary install simplifies to `npm i -g google-deep-research`.

The `skills` CLI is from [vercel-labs/skills](https://github.com/vercel-labs/skills) and follows the open Agent Skills spec — same install command works for Claude Code, Gemini CLI, Codex CLI, and 40+ other agents. Add `-g` to install user-globally instead of project-scoped, or `-a claude-code -a gemini-cli` to target specific agents.

### Install troubleshooting

**`gdr: command not found` after install.** Make sure `$(npm config get prefix)/bin` is on your `PATH`. With nvm/fnm this happens automatically when nvm is sourced; without nvm, add it to your shell rc.

**`spawn sh ENOENT` on `node_modules/protobufjs`.** You used `npm i -g github:tayzar-tznw/deepresearch-cli` (the `github:` shortcut). That path runs a nested `npm install --force` to "prep" the git dep, which trips a postinstall race in protobufjs on Node 22+. **Use the tarball URL above instead** — it skips the prep step entirely and installs cleanly.

**`ENOTDIR` retire-rename error during reinstall.** A previous failed install left a non-directory entry in your global `node_modules`. Force-clean it before retrying:
```bash
PREFIX=$(npm config get prefix)
rm -rf $PREFIX/lib/node_modules/google-deep-research $PREFIX/lib/node_modules/.google-deep-research-* $PREFIX/bin/gdr
```

**Manual fallback** (clone + link, no global npm dep install):
```bash
git clone https://github.com/tayzar-tznw/deepresearch-cli.git
cd deepresearch-cli
npm install --ignore-scripts && npm link
gdr --version
```

Then set up auth — **two paths, Vertex AI is the default**:

### Option A — Vertex AI (default, uses your Google Cloud account)

```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=your-gcp-project
export GOOGLE_CLOUD_LOCATION=global   # optional, default 'global'
```

…or persist the project/location in the config:

```bash
gdr config set vertexProject your-gcp-project
gdr config set vertexLocation global
```

> ⚠️ Deep Research and Deep Research Max launched on the **Gemini Developer API** on 2026-04-21. Vertex AI / Google Cloud availability was announced as "coming soon"; the model may not yet be reachable on Vertex. If your `gdr` calls fail with a model-not-found error, switch to Option B below until rollout completes.

### Option B — Gemini Developer API (override, uses an API key)

```bash
gdr auth                  # paste your GEMINI_API_KEY (stored chmod 600 in ~/.config/gdr/config.json)
# or
export GEMINI_API_KEY=AIza...
```

Get a paid-tier key at <https://aistudio.google.com/apikey>. Deep Research is **not on the free tier**.

Or use the one-liner installer (handles both paths):

```bash
curl -fsSL https://raw.githubusercontent.com/tayzar-tznw/deepresearch-cli/main/scripts/install.sh | bash
```

## Quickstart

```bash
# Fire-and-forget a Max-tier deep dive (default tier)
gdr start "EU AI Act enforcement timeline 2026" --name eu-ai-act --confirm-cost --json
# → { "id": "...", "state": "in_progress", "cost_estimate": "$4.80", "next": "gdr wait ..." }

# Resume polling whenever (safe to Ctrl-C and re-run)
gdr wait <id>

# Save the report locally
gdr fetch <id> --out ./research/eu-ai-act
# → ./research/eu-ai-act/report.md   plus chart-*.html, image-*.png, outputs.json

# Or do everything synchronously (good for short jobs only)
gdr run "Voyager 1 distance from Earth right now" --standard --out ./research/voyager
```

## Cost guardrails

Max-tier runs are blocked unless you opt in with **one** of:

- `--confirm-cost` flag
- `GDR_CONFIRM_COST=1` env var
- `costCeilingUsd` ≥ $5 in `~/.config/gdr/config.json` (`gdr config set costCeilingUsd 25`)

`gdr list` shows your 30-day estimated spend across cached jobs.

## Subcommands

| Command | What it does |
|---|---|
| `gdr start <query>` | Create a job and exit. Prints id + cost. |
| `gdr wait <id>` | Poll until done. Resumable. |
| `gdr run <query>` | Start + wait + fetch in one shot (short jobs only). Add `--stream` for live SSE. |
| `gdr status <id>` | One-shot status. |
| `gdr list` | Local job cache + monthly spend. |
| `gdr follow <id>` | **Stream Gemini's `thought_summary` deltas + report text live (SSE).** `--no-thoughts` hides reasoning; `--tool-calls` surfaces search queries / URL fetches. |
| `gdr fetch <id>` | Download report + charts + images. |
| `gdr cancel <id>` | Server-side cancel. |
| `gdr auth` | Store / show / clear API key. |
| `gdr config <get\|set\|list> ...` | Read or write config keys. |
| `gdr doctor` | Diagnose auth, network, skill install. |
| `gdr install-skills` | Manual fallback if you don't want to use `npx skills add`. |

Run `gdr <cmd> --help` for full flags. Add `--json` to any command for machine-readable output (used by the skills).

## Claude Code skills

`gdr install-skills` drops three Claude Code skills into `~/.claude/skills/`:

- **`deep-research`** — auto-triggers on "deep dive", "comprehensive report", "literature review", etc. Fires `gdr start`, then `gdr wait`, then `gdr fetch`.
- **`research-status`** — auto-triggers when you ask "is my research done?" or reference a prior job. Lists, polls, and fetches.
- **`research-with-files`** — auto-triggers when you attach files and ask for grounded research.

The skills always use `gdr start` then `gdr wait` (rather than the blocking `gdr run`), so a dropped Claude session never kills the job — the job lives server-side and you can resume from any session via `research-status`.

## Use from other agents

Any agent that can shell out works:

- **Gemini CLI** — `gdr` is just a binary; let the model call it via the Bash tool.
- **Codex CLI** — same.
- **Bash scripts / cron** — `gdr start … --json | jq -r .id` then poll.

There's no MCP server in v1. If you want one, file an issue.

## Auth resolution order

If **any** API key is set, the Gemini Developer API is used; otherwise Vertex AI:

1. `GEMINI_API_KEY` env var → Gemini Dev API
2. `GOOGLE_API_KEY` env var → Gemini Dev API
3. `apiKey` field in `~/.config/gdr/config.json` → Gemini Dev API
4. `GOOGLE_CLOUD_PROJECT` env (with ADC) → Vertex AI
5. `vertexProject` field in `~/.config/gdr/config.json` (with ADC) → Vertex AI

`GOOGLE_CLOUD_LOCATION` / `GOOGLE_CLOUD_REGION` env (or `vertexLocation` config) sets the Vertex region; default `global`.

The config file is written `chmod 600` and `~/.config/gdr/` is `chmod 700`.

`gdr auth --show` reports the active mode (and project / masked key).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | OK |
| 1 | Generic error |
| 2 | Auth — missing or invalid API key |
| 3 | Quota / rate limit |
| 4 | Validation — bad arguments or cost guardrail |
| 5 | Poll timeout — job still running, re-run `gdr wait <id>` |
| 6 | Job ended in `failed`/`cancelled`/`incomplete` |
| 7 | `gdr doctor` found problems |

## Dry-run mode

For local development and CI:

```bash
GDR_DRY_RUN=1 gdr run "test" --out /tmp/gdr-test
```

No real API call, no money spent. Always returns a stub report.

## Limitations (v1)

- No MCP server (planned: file an issue if you need one).
- No browser automation against the consumer Gemini app.
- No multi-provider abstraction (only Google).
- Local job cache is per-machine; jobs from another machine won't appear in `gdr list`.
- Charts are saved as raw HTML; no thumbnail rendering.

## License

MIT
