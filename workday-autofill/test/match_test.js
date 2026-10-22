// Replays logged fields (a .jsonl of {label, kind, automationId}) through the
// REAL matcher (engine.js matchField + mappings.js), with no DOM.
const fs = require("fs"), vm = require("vm"), path = require("path");
const EXT = require("path").resolve(__dirname, "..");

function harness(hostname) {
  const sandbox = {
    console,
    window: {},
    document: { querySelectorAll: () => [], querySelector: () => null,
                documentElement: { getAttribute: () => null, setAttribute: () => {} } },
    location: { hostname },
    performance: { now: () => Date.now() },
    getComputedStyle: () => ({}),
    MutationObserver: function () { this.observe = () => {}; },
    setTimeout, clearTimeout,
  };
  vm.createContext(sandbox);
  // In a browser `window` IS the global object, so `window.WDAF = ...` creates
  // a bare global. Mirror that: window === globalThis inside the sandbox.
  vm.runInContext("window = globalThis;", sandbox);
  // PROFILE=profile.js to test your own answers; default is the fictional persona
  const prof = process.env.PROFILE || "test/sample_profile.js";
  for (const f of [prof, "src/dom.js", "src/mappings.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXT, f), "utf8"), sandbox, { filename: f });
  }
  let eng = fs.readFileSync(path.join(EXT, "src/engine.js"), "utf8");
  const NEEDLE = "return {\n    fillStep, dumpUnmapped, clearUnmapped,";
  if (!eng.includes(NEEDLE)) throw new Error("export patch anchor not found");
  eng = eng.replace(NEEDLE, "return {\n    matchField, resolve, fillStep, dumpUnmapped, clearUnmapped,");
  vm.runInContext(eng, sandbox, { filename: "engine.js" });
  return sandbox.window.WDAF;
}

const rows = fs.readFileSync(process.argv[2] || path.join(__dirname, "sample_fields.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
  .filter(Boolean);

const seen = new Map();
for (const r of rows) {
  const k = (r.automationId || "") + " || " + (r.label || "") + " || " + r.kind;
  if (!seen.has(k)) seen.set(k, { ...r, n: 0, hosts: new Set() });
  seen.get(k).n++; seen.get(k).hosts.add((r.host || "").split(".")[0]);
}

const out = [];
for (const f of seen.values()) {
  const W = harness([...f.hosts][0] + ".wd1.myworkdayjobs.com");
  const field = { automationId: f.automationId || "", label: f.label || "", kind: f.kind };
  const resolver = W.engine.matchField(field);
  let value = null;
  if (resolver) value = W.engine.resolve(resolver, field);
  const blank = value === "" || value === null || value === undefined || value === false;
  // Classes the engine now handles at the COLLECTION layer, before matching:
  // these never reach the label table at all (verified in the browser fixture).
  const L = (f.label || "").trim();
  const collection =
    /^(job title|company|location|role description|i currently work here|from|to)\*?$/i.test(L) ? "block-field"
    : f.automationId === "utilityMenuButton" ? "page-furniture"
    : /^language \w+ required$/i.test(L) ||
      /^(overall|comprehension|reading|speaking|writing)\b/i.test(L) ||
      /^i am fluent in this language/i.test(L) ? "language-row"
    : /required$/i.test(L) && /^(yes|no|select one|4th year|high school)/i.test(L) ? "self-label"
    : null;
  const state = !resolver ? (collection || "UNMATCHED") : blank ? "matched-blank" : "FILLS";
  out.push({ ...f, state, value: value === true ? "(check)" : String(value === null ? "" : value).slice(0, 34) });
}

out.sort((a, b) => b.n - a.n);
const tally = {};
for (const o of out) tally[o.state] = (tally[o.state] || 0) + o.n;
console.log("records:", rows.length, "distinct:", out.length);
console.log("by occurrence:", JSON.stringify(tally));
console.log("");
for (const o of out) {
  const aid = (o.automationId || "-").slice(0, 24).padEnd(24);
  console.log(String(o.n).padStart(3) + " " + o.state.padEnd(13) + " " + (o.kind || "").padEnd(9) +
              " " + aid + " | " + (o.label || "").slice(0, 60).padEnd(60) + " | " + o.value);
}
