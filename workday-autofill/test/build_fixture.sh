#!/bin/zsh
# Builds a self-contained synthetic Workday page with the LIVE extension code
# inlined (a file:// page can't load file:// scripts, and Playwright blocks
# file:// anyway — serve it over localhost).
#
#   zsh test/build_fixture.sh
#   python3 -m http.server 8799 --directory test   # then open /fixture.html
#   in the page console:  await runFill()
#
# runFill() returns { filled, skipped, unmapped[], snapshot } — `unmapped`
# should stay EMPTY: every field on the fixture is either answered from
# profile.js or deliberately skipped.
set -e
HERE=${0:a:h}
EXT=${HERE:h}
OUT=$HERE/fixture.html

{
  echo '<!doctype html><meta charset="utf-8"><title>WDAF fixture</title><body>'
  cat $HERE/fixture_body.html
  for f in test/sample_profile.js src/dom.js src/mappings.js src/engine.js; do
    echo "<script>/* $f */"
    cat $EXT/$f
    echo '</script>'
  done
  echo '<script>'; cat $HERE/fixture_widgets.js; echo '</script>'
  echo '<script>'; cat $HERE/fixture_cc305.js; echo '</script>'
  echo '<script>'; cat $HERE/fixture_run.js; echo '</script>'
} > $OUT
echo "built $OUT ($(wc -c < $OUT) bytes)"
