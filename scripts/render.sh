#!/usr/bin/env bash
# Render a tailored resume to PDF.
#
#   scripts/render.sh applications/<slug>
#
# Steps: validate against master data -> compile with Typst -> check the
# page count -> optionally archive a copy to output.archive_dir.
#
# The filename pattern, archive directory, and page limit all come from
# config.yaml. This is the ONLY supported build path: do not call `typst`
# by hand, or you skip the validation gate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_DIR="${1:?usage: render.sh applications/<slug>}"
APP_DIR="${APP_DIR%/}"
TAILORED="$APP_DIR/tailored.yaml"
[ -f "$TAILORED" ] || { echo "ERROR: $TAILORED not found"; exit 1; }

command -v typst >/dev/null 2>&1 || {
  echo "ERROR: typst is not installed. Run scripts/setup.sh, or see the README."
  exit 1
}

# Gate: never render something that does not validate against master data.
python3 scripts/validate.py "$TAILORED"

# Filename + archive dir come from profile, meta, and config.
read -r OUT_NAME ARCHIVE_DIR MAX_PAGES <<EOF
$(python3 - "$TAILORED" <<'PY'
import os, re, sys, yaml

def clean(s):
    return re.sub(r"_+", "_", re.sub(r"[^A-Za-z0-9]", "_", str(s))).strip("_")

def load(path, default=None):
    if not os.path.exists(path):
        return default if default is not None else {}
    with open(path) as f:
        return yaml.safe_load(f) or (default if default is not None else {})

t = load(sys.argv[1])
p = load("data/profile.yaml")
cfg = load("config.yaml")
out = cfg.get("output") or {}
rules = cfg.get("rules") or {}
m = t.get("meta", {})

pattern = out.get("filename") or "{name}_{company}_{role_short}_Resume.pdf"
name = pattern.format(
    name=clean(p.get("name", "Resume")),
    company=clean(m.get("company", "Company")),
    role=clean(m.get("role", "Role")),
    role_short=clean(m.get("role_short", m.get("role", "Role"))),
)
archive = os.path.expanduser(str(out.get("archive_dir") or "")) or "-"
print(name, archive, rules.get("max_pages", 1))
PY
)
EOF

OUT="$APP_DIR/$OUT_NAME"
typst compile --root "$ROOT" templates/resume.typ --input data="/$TAILORED" "$OUT"

# Page-count check (warning only; the fix is to trim bullets and re-render).
PAGES=$(python3 - "$OUT" <<'PY' 2>/dev/null || echo "?"
import sys
from pypdf import PdfReader
print(len(PdfReader(sys.argv[1]).pages))
PY
)
if [ "$PAGES" = "?" ]; then
  echo "NOTE: could not count pages (is pypdf installed?)"
elif [ "$PAGES" -le "$MAX_PAGES" ] 2>/dev/null; then
  echo "OK: $PAGES page(s)"
else
  echo "WARNING: resume is $PAGES pages but the limit is $MAX_PAGES. Trim bullets in $TAILORED and re-render."
fi
echo "PDF: $ROOT/$OUT"

# Optional archive copy, so every resume you build also lands in one folder.
# Set output.archive_dir in config.yaml to enable it.
if [ "$ARCHIVE_DIR" != "-" ] && [[ "$APP_DIR" != *"/_example"* ]]; then
  if mkdir -p "$ARCHIVE_DIR" 2>/dev/null && cp "$OUT" "$ARCHIVE_DIR/" 2>/dev/null; then
    echo "Archived: $ARCHIVE_DIR/$(basename "$OUT")"
  else
    # Fail soft: a blocked copy (permissions, sandboxed launch context) must
    # never fail the build. The canonical PDF already exists above.
    echo "WARN: archive copy skipped (permissions?). PDF is still at $ROOT/$OUT"
  fi
fi
