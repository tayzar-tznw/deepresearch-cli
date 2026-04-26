#!/usr/bin/env bash
# One-liner installer for google-deep-research.
# Usage: curl -fsSL <url-of-this-script> | bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required (>=18.17). install from https://nodejs.org/" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm is required" >&2
  exit 1
fi

echo "==> installing google-deep-research globally via npm"
npm install -g google-deep-research

echo "==> registering Claude Code skills"
gdr install-skills --force

if [[ -z "${GEMINI_API_KEY:-}" ]] && ! gdr config get apiKey 2>/dev/null | grep -q '"apiKey": *"'; then
  echo "==> setting up auth (paste your Gemini API key from https://aistudio.google.com/apikey)"
  gdr auth
fi

gdr doctor
echo "done. try: gdr run \"What is the Voyager 1 distance from Earth?\" --standard"
