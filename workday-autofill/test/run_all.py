#!/usr/bin/env python3
"""Headless regression run of every fixture page: builds them, serves test/
on localhost, calls runFill() twice (second pass must be idempotent) and
fails if anything comes back unmapped.  Usage: python3 test/run_all.py"""
import http.server, json, socketserver, subprocess, sys, threading
from functools import partial
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
FIXTURES = [("build_fixture.sh", "fixture.html"),
            ("build_edu.sh", "fixture_edu.html"),
            ("build_empty.sh", "fixture_empty.html")]

for script, _ in FIXTURES:
    subprocess.run(["zsh", str(HERE / script)], check=True, capture_output=True)

handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(HERE))
handler.log_message = lambda *a: None
srv = socketserver.TCPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]

failed = False
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for _, html in FIXTURES:
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{port}/{html}")
        page.wait_for_function("typeof window.runFill === 'function'")
        r1 = page.evaluate("async () => { const r = await runFill(); return JSON.parse(JSON.stringify(r)); }")
        r2 = page.evaluate("async () => { const r = await runFill(); return JSON.parse(JSON.stringify(r)); }")
        un = (r1 or {}).get("unmapped") or []
        ok = not un and not errors
        failed |= not ok
        print(f"{'PASS' if ok else 'FAIL'} {html}: filled={r1.get('filled')} "
              f"skipped={r1.get('skipped')} unmapped={len(un)} "
              f"pass2_filled={r2.get('filled')} errors={errors[:3]}")
        snap = r1.get("snapshot")
        if snap is not None:
            (HERE / f".snapshot_{html}.json").write_text(json.dumps(snap, indent=1, sort_keys=True))
        if un:
            print("   unmapped:", json.dumps(un)[:600])
    browser.close()
srv.shutdown()
sys.exit(1 if failed else 0)
