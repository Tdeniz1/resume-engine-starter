#!/usr/bin/env bash
# One-time dependency setup. Safe to re-run.
#
#   scripts/setup.sh
#
# Installs: typst (PDF compiler), pyyaml + pypdf (validation, page count).
set -uo pipefail

echo "resume-engine setup"
echo

ok=1

if command -v typst >/dev/null 2>&1; then
  echo "  typst      OK ($(typst --version 2>/dev/null))"
else
  echo "  typst      MISSING"
  if command -v brew >/dev/null 2>&1; then
    echo "             installing with Homebrew..."
    brew install typst && echo "             done" || ok=0
  elif command -v cargo >/dev/null 2>&1; then
    echo "             installing with cargo..."
    cargo install --locked typst-cli && echo "             done" || ok=0
  elif command -v winget >/dev/null 2>&1; then
    echo "             run: winget install --id Typst.Typst"
    ok=0
  else
    echo "             install it manually: https://github.com/typst/typst#installation"
    ok=0
  fi
fi

if python3 -c "import yaml, pypdf" 2>/dev/null; then
  echo "  pyyaml     OK"
  echo "  pypdf      OK"
else
  echo "  python deps MISSING, installing..."
  python3 -m pip install --user --quiet pyyaml pypdf 2>/dev/null \
    || python3 -m pip install --break-system-packages --user --quiet pyyaml pypdf 2>/dev/null \
    || { echo "             pip install failed. Try: python3 -m pip install --user pyyaml pypdf"; ok=0; }
  python3 -c "import yaml, pypdf" 2>/dev/null && echo "             done"
fi

chmod +x "$(dirname "$0")"/*.sh 2>/dev/null

echo
if [ "$ok" = "1" ] && python3 -c "import yaml, pypdf" 2>/dev/null && command -v typst >/dev/null 2>&1; then
  echo "All set. Smoke-test the pipeline with the shipped example:"
  echo "  RESUME_ALLOW_SAMPLE=1 scripts/render.sh applications/_example"
  echo
  echo "Then put your own history into intake/PASTE_YOUR_INFO.md and run /intake in your agent."
else
  echo "Some dependencies are still missing. See the notes above, then re-run this script."
  exit 1
fi
