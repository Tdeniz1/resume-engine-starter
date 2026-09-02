#!/usr/bin/env bash
# PostToolUse hook: whenever Claude writes/edits a tailored.yaml, validate it
# against master data immediately. Exit 2 feeds the errors back to Claude.
set -uo pipefail

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)

case "$FILE_PATH" in
  */applications/*/tailored.yaml|applications/*/tailored.yaml)
    ROOT="$(cd "$(dirname "$0")/.." && pwd)"
    if ! OUT=$(cd "$ROOT" && python3 scripts/validate.py "$FILE_PATH" 2>&1); then
      {
        echo "tailored.yaml failed validation against master data:"
        echo "$OUT"
        echo "Fix the tailored file — or, if a fact is real but missing, add it to data/ first."
      } >&2
      exit 2
    fi
    ;;
esac
exit 0
