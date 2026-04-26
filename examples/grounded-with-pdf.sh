#!/usr/bin/env bash
# Ground Deep Research Max in a local PDF and a web URL.
set -euo pipefail

PDF="${1:?usage: grounded-with-pdf.sh <path-to-pdf> [extra-url]}"
URL="${2:-}"

CMD=(gdr start
  "Summarize the attached paper, then find related work published since."
  --file "$PDF"
  --name "grounded-$(basename "$PDF" .pdf)"
  --plan
  --confirm-cost
  --json)

if [[ -n "$URL" ]]; then
  CMD+=(--url "$URL")
fi

RESULT=$("${CMD[@]}")
ID=$(printf '%s' "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
echo "started: $ID"

gdr wait "$ID"
gdr fetch "$ID" --out "./research/$ID" --format md
echo "report at ./research/$ID/report.md"
