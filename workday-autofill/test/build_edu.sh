#!/bin/zsh
# Same inlining trick as build_fixture.sh, for the empty-section page.
set -e
HERE=${0:a:h}
EXT=${HERE:h}
OUT=$HERE/fixture_edu.html
{
  echo '<!doctype html><meta charset="utf-8"><title>WDAF education</title><body>'
  cat $HERE/fixture_edu_body.html
  for f in test/sample_profile.js src/dom.js src/mappings.js src/engine.js; do
    echo "<script>/* $f */"; cat $EXT/$f; echo '</script>'
  done
  echo '<script>'; cat $HERE/fixture_edu.js; echo '</script>'
  echo '<script>'; cat $HERE/fixture_edu_run.js; echo '</script>'
} > $OUT
echo "built $OUT"
