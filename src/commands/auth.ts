import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readConfig, resolveAuth, writeConfig } from "../store/config.js";
import { configFilePath } from "../store/paths.js";
import { Logger } from "../output/logger.js";
import { ValidationError } from "../util/errors.js";
import type { GlobalOpts } from "./types.js";

export interface AuthOpts extends GlobalOpts {
  key?: string;
  show?: boolean;
  reveal?: boolean;
  clear?: boolean;
}

export async function authCmd(opts: AuthOpts): Promise<void> {
  const log = new Logger(opts);
  const cfg = await readConfig();

  if (opts.clear) {
    delete cfg.apiKey;
    await writeConfig(cfg);
    log.success(`cleared apiKey from ${configFilePath()} — auth will fall back to Vertex AI`);
    return;
  }

  if (opts.show) {
    const auth = await resolveAuth(cfg);
    if (!auth) {
      log.emit({
        mode: "none",
        hint: "set GEMINI_API_KEY or run `gdr auth --key ...` for Gemini Developer API; otherwise set GOOGLE_CLOUD_PROJECT + run `gcloud auth application-default login` for Vertex AI",
      });
      return;
    }
    if (auth.mode === "vertex") {
      log.emit({
        mode: "vertex",
        project: auth.project,
        location: auth.location,
        project_source: auth.projectSource,
      });
      return;
    }
    if (opts.reveal) {
      log.emit({ mode: "api-key", apiKey: auth.apiKey, source: auth.source });
    } else {
      const k = auth.apiKey;
      const masked = k.slice(0, 6) + "***" + k.slice(-4);
      log.emit({
        mode: "api-key",
        apiKey_masked: masked,
        source: auth.source,
        hint: "use --show --reveal for raw value",
      });
    }
    return;
  }

  let key = opts.key;
  if (!key) {
    if (!input.isTTY) throw new ValidationError("no --key provided and stdin is not a TTY");
    const rl = createInterface({ input, output });
    key = (await rl.question("Paste GEMINI_API_KEY: ")).trim();
    rl.close();
  }
  if (!key.startsWith("AIza")) {
    log.warn("key does not look like a Google API key (expected AIza... prefix). Saving anyway.");
  }
  cfg.apiKey = key;
  await writeConfig(cfg);
  log.success(`saved apiKey to ${configFilePath()} (chmod 600)`);
}
