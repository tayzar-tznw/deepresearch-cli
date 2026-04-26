#!/usr/bin/env bash
# Basic Deep Research Max query: fire-and-forget, then poll separately.
set -euo pipefail

QUERY="${1:-What are the open-source Deep Research clones as of April 2026, with feature comparison?}"

# 1. Start the job (Max tier, default).
RESULT=$(gdr start "$QUERY" --name basic-query --confirm-cost --json)
ID=$(printf '%s' "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
echo "started: $ID"

# 2. Wait (resumable — safe to Ctrl-C and re-run with the same ID).
gdr wait "$ID"

# 3. Fetch report + artifacts.
gdr fetch "$ID" --out "./research/$ID" --format md
echo "report at ./research/$ID/report.md"
