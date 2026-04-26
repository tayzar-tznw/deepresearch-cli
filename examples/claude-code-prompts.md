# Claude Code prompts that exercise the skills

Once you've run `gdr install-skills`, these prompts will auto-trigger the bundled skills.

## `deep-research` skill

> Do a deep dive on the state of post-quantum cryptography migration in 2026, focusing on what major cloud providers and CDNs have actually deployed.

> Comprehensive market analysis of the AI-native code editor space — Claude Code, Gemini CLI, Codex CLI, Cursor, Windsurf, Zed AI. Pricing, feature parity, agent loop architectures.

> Literature review of recent papers on world models for embodied agents.

## `research-with-files` skill

> Here's a 30-page paper at `./papers/foo.pdf`. Read it, then research what other groups have published on the same topic since.

> I've got `./benchmarks/results.csv`. Compare these numbers to the published state-of-the-art and write a report.

## `research-status` skill

> Did the EU AI Act research finish?

> What's the status of the deep dive I started earlier on rust async runtimes?

> List my recent research jobs.

## Manually invoking

If Claude doesn't auto-trigger the skill (description didn't match), say:

> Use the `deep-research` skill to investigate X.

> Use the `research-status` skill to check on my jobs.
