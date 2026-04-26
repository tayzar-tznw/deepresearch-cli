import { Command, Option } from "commander";
import pc from "picocolors";
import { startCmd } from "./commands/start.js";
import { waitCmd } from "./commands/wait.js";
import { runCmd } from "./commands/run.js";
import { statusCmd } from "./commands/status.js";
import { listCmd } from "./commands/list.js";
import { followCmd } from "./commands/follow.js";
import { fetchCmd } from "./commands/fetch.js";
import { cancelCmd } from "./commands/cancel.js";
import { refineCmd } from "./commands/refine.js";
import { authCmd } from "./commands/auth.js";
import { configGetCmd, configListCmd, configSetCmd } from "./commands/config.js";
import { doctorCmd } from "./commands/doctor.js";
import { installSkillsCmd } from "./commands/install-skills.js";
import { ExitCode, GdrError } from "./util/errors.js";
import { redact } from "./util/redact.js";

const VERSION = "0.1.0";

const program = new Command();
program
  .name("gdr")
  .description("Google Deep Research Max — CLI wrapper around the Gemini Interactions API")
  .version(VERSION)
  .option("--json", "emit JSON to stdout instead of human-readable text")
  .option("--quiet", "suppress informational logs")
  .option("--no-color", "disable ANSI colors")
  .option("--config <path>", "use this config file instead of ~/.config/gdr/config.json");

function global(cmd: Command) {
  return cmd.optsWithGlobals();
}

program
  .command("start <query>")
  .description("create a Deep Research job and exit immediately (default tier: MAX)")
  .option("--standard", "use the cheaper Standard tier (~$1.22) instead of Max (~$4.80)")
  .option("--no-web", "disable web search; use only attached files/URLs")
  .option("--file <path...>", "attach a local file (PDF/CSV/image/audio/video) — repeatable", collect, [])
  .option("--url <url...>", "attach a URL for grounding — repeatable", collect, [])
  .option("--code-exec", "enable code execution tool")
  .option("--plan", "use collaborative planning — agent returns a plan first; refine via `gdr refine <id> ...`. Auto-routes the plan turn to Standard tier (Max ignores the flag in current preview)")
  .addOption(new Option("--plan-tier <tier>", "force the plan turn's tier (advanced)").choices(["max", "standard"]))
  .option("--name <label>", "human-readable label for the job (used by `list` and `research-status` skill)")
  .option("--confirm-cost", "explicitly acknowledge Max-tier cost (~$4.80)")
  .action((query: string, opts: object, cmd: Command) => run(() => startCmd(query, { ...global(cmd), ...opts })));

program
  .command("wait <id>")
  .description("poll a running job until it completes (resumable: safe to Ctrl-C and re-run)")
  .option("--timeout <minutes>", "max minutes to poll before giving up", "60")
  .option("--interval <seconds>", "initial poll interval (exp backoff to 60s)", "15")
  .action((id: string, opts: object, cmd: Command) => run(() => waitCmd(id, { ...global(cmd), ...opts })));

program
  .command("run <query>")
  .description("start + wait + fetch — convenience for short jobs")
  .option("--standard", "use Standard tier instead of Max")
  .option("--no-web", "disable web search")
  .option("--file <path...>", "attach a local file — repeatable", collect, [])
  .option("--url <url...>", "attach a URL — repeatable", collect, [])
  .option("--code-exec", "enable code execution tool")
  .option("--plan", "collaborative planning")
  .option("--name <label>", "label for the job")
  .option("--confirm-cost", "acknowledge Max-tier cost")
  .option("--out <dir>", "output directory for the report and artifacts", "./research")
  .addOption(new Option("--format <fmt>", "report format").choices(["md", "json", "html"]).default("md"))
  .option("--timeout <minutes>", "max minutes to wait", "30")
  .option("--interval <seconds>", "poll interval (only when not streaming)", "15")
  .option("--stream", "stream thought_summary + text deltas live (SSE) instead of polling")
  .option("--no-thoughts", "with --stream, hide thought_summary deltas")
  .option("--tool-calls", "with --stream, also surface tool invocations")
  .action((query: string, opts: object, cmd: Command) => run(() => runCmd(query, { ...global(cmd), ...opts })));

program
  .command("status <id>")
  .description("one-shot status check for a job")
  .action((id: string, opts: object, cmd: Command) => run(() => statusCmd(id, { ...global(cmd), ...opts })));

program
  .command("list")
  .description("list cached jobs and 30-day estimated spend")
  .option("--state <state>", "filter by state (in_progress / completed / failed / cancelled)")
  .option("--limit <n>", "max rows to show")
  .action((opts: object, cmd: Command) => run(() => listCmd({ ...global(cmd), ...opts })));

program
  .command("follow <id>")
  .description("stream Gemini's thoughts and report deltas in real time (SSE)")
  .option("--no-thoughts", "hide thought_summary deltas; show only output text")
  .option("--tool-calls", "also surface tool invocations (search queries, URL fetches, code exec)")
  .option("--resume-from <event-id>", "resume the stream from a specific event id (after a disconnect)")
  .action((id: string, opts: object, cmd: Command) => run(() => followCmd(id, { ...global(cmd), ...opts })));

program
  .command("fetch <id>")
  .description("download the report and artifacts for a finished job")
  .option("--out <dir>", "output directory", "./research")
  .addOption(new Option("--format <fmt>", "report format").choices(["md", "json", "html"]).default("md"))
  .option("--include-artifacts", "also save charts and images (default: yes)")
  .action((id: string, opts: object, cmd: Command) => run(() => fetchCmd(id, { ...global(cmd), ...opts })));

program
  .command("cancel <id>")
  .description("cancel a running job (server-side)")
  .action((id: string, opts: object, cmd: Command) => run(() => cancelCmd(id, { ...global(cmd), ...opts })));

program
  .command("refine <parent-id> [message]")
  .description("send a plan refinement / approval / follow-up to a prior job (creates a continuation linked via previous_interaction_id)")
  .option("--approve", "approve the parent's proposed plan as-is, no message needed")
  .option("--name <label>", "label for the refinement job")
  .option("--confirm-cost", "acknowledge Max-tier cost (~$4.80) for the continuation")
  .action((parentId: string, message: string | undefined, opts: object, cmd: Command) =>
    run(() => refineCmd(parentId, message, { ...global(cmd), ...opts })),
  );

const auth = program
  .command("auth")
  .description("store, show, or clear your Gemini API key in ~/.config/gdr/config.json")
  .option("--key <value>", "set API key non-interactively")
  .option("--show", "show the stored key (masked unless --reveal)")
  .option("--reveal", "with --show, print the unmasked key")
  .option("--clear", "remove the stored key")
  .action((opts: object, cmd: Command) => run(() => authCmd({ ...global(cmd), ...opts })));
auth.exitOverride();

const config = program
  .command("config")
  .description("read or write configuration values");
config
  .command("get <key>")
  .action((key: string, opts: object, cmd: Command) => run(() => configGetCmd(key, { ...global(cmd), ...opts })));
config
  .command("set <key> <value>")
  .action((key: string, value: string, opts: object, cmd: Command) =>
    run(() => configSetCmd(key, value, { ...global(cmd), ...opts })),
  );
config
  .command("list")
  .action((opts: object, cmd: Command) => run(() => configListCmd({ ...global(cmd), ...opts })));

program
  .command("doctor")
  .description("verify auth, network, API reachability, and skill registration")
  .action((opts: object, cmd: Command) => run(() => doctorCmd({ ...global(cmd), ...opts })));

program
  .command("install-skills")
  .description("copy bundled Claude Code skills into ~/.claude/skills/")
  .option("--force", "overwrite existing skills")
  .option("--dry-run", "report what would be installed without writing")
  .option("--target <dir>", "install to a different directory")
  .action((opts: object, cmd: Command) => run(() => installSkillsCmd({ ...global(cmd), ...opts })));

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function run(fn: () => Promise<void>): void {
  fn().catch((err: unknown) => {
    if (err instanceof GdrError) {
      process.stderr.write(`${pc.red("error")} ${redact(err.message)}\n`);
      process.exit(err.exitCode);
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${pc.red("error")} ${redact(message)}\n`);
    process.exit(ExitCode.Generic);
  });
}

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${pc.red("error")} ${message}\n`);
  process.exit(ExitCode.Generic);
});
