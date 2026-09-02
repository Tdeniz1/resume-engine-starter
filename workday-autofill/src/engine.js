// ============================================================================
// engine.js — walks the current Workday step, matches fields to the profile,
// and fills them. Every field fill is individually try/caught: one bad field
// never stops the rest. Never touches Submit/Next/Continue.
// ============================================================================
window.WDAF = window.WDAF || {};

WDAF.engine = (() => {
  const D = () => WDAF.dom;
  const M = () => WDAF.mappings;

  // Active profile = profile.js merged with per-job overrides that a driver
  // (the autopilot) can set from the page world, since content scripts share
  // the DOM: document.documentElement.setAttribute('data-wdaf-overrides',
  //   JSON.stringify({application: {desiredSalary: "125000"}}))
  let activeProfile = window.WDAF_PROFILE;
  const P = () => activeProfile;

  function applyOverrides() {
    activeProfile = window.WDAF_PROFILE;
    try {
      const raw = document.documentElement.getAttribute("data-wdaf-overrides");
      if (!raw) return;
      const over = JSON.parse(raw);
      const merged = { ...window.WDAF_PROFILE };
      for (const [k, v] of Object.entries(over)) {
        merged[k] = (v && typeof v === "object" && !Array.isArray(v))
          ? { ...merged[k], ...v } : v;
      }
      activeProfile = merged;
    } catch (e) { D().log("bad data-wdaf-overrides JSON, ignoring", e); }
  }

  let filling = false;
  let lastStats = { filled: 0, skipped: 0 };

  const BLOCK_SEL = '[data-automation-id^="workExperience-"], [data-automation-id^="education-"]';

  // -------------------------------------------------------------------------
  // Field discovery
  // -------------------------------------------------------------------------
  function collectFields() {
    const d = D();
    const out = [];
    const inBlock = (el) => !!el.closest(BLOCK_SEL);

    for (const el of document.querySelectorAll("input, textarea")) {
      const type = (el.type || "text").toLowerCase();
      if (["hidden", "password", "file", "submit", "button", "search"].includes(type)) continue;
      if (inBlock(el)) continue;
      const aid = el.getAttribute("data-automation-id") || "";
      if (/dateSection(Month|Day|Year)-input/.test(aid)) continue; // via wrapper
      if (aid === "searchBox") continue;                            // multiselect internals
      if (type === "radio") continue;                               // grouped below
      if (type === "checkbox") {
        if (d.isVisible(d.clickTargetFor(el))) out.push(desc("checkbox", el));
        continue;
      }
      if (!d.isVisible(el)) continue;
      out.push(desc(el.tagName === "TEXTAREA" ? "textarea" : "text", el));
    }

    for (const el of document.querySelectorAll('button[aria-haspopup="listbox"]')) {
      if (d.isVisible(el) && !inBlock(el)) out.push(desc("dropdown", el));
    }

    // Radio groups, keyed by input name
    const groups = new Map();
    for (const r of document.querySelectorAll('input[type="radio"]')) {
      if (inBlock(r) || !d.isVisible(d.clickTargetFor(r))) continue;
      const key = r.name || "wdaf-anon";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const radios of groups.values()) {
      const container = radios[0].closest('fieldset, [role="radiogroup"], [data-automation-id^="formField"]')
        || radios[0].parentElement;
      const dsc = desc("radiogroup", container);
      dsc.radios = radios;
      out.push(dsc);
    }

    for (const w of document.querySelectorAll('[data-automation-id="dateInputWrapper"], [data-automation-id="dateSection"]')) {
      if (inBlock(w)) continue;
      if (w.querySelector('input[data-automation-id^="dateSection"]')) out.push(desc("date", w));
    }
    return out;
  }

  function desc(kind, el) {
    return {
      kind, el,
      automationId: (el.getAttribute && el.getAttribute("data-automation-id")) || "",
      label: D().labelFor(el).trim(),
    };
  }

  // -------------------------------------------------------------------------
  // Matching: exact automation-id → exact label → fuzzy contains (unique only)
  // -------------------------------------------------------------------------
  function matchField(f) {
    const m = M();
    if (f.automationId) {
      if (m.byAutomationId[f.automationId]) return m.byAutomationId[f.automationId];
      const tail = f.automationId.split("--").pop(); // e.g. personalInfoUS--gender
      if (tail !== f.automationId && m.byAutomationId[tail]) return m.byAutomationId[tail];
    }
    const label = D().norm(f.label);
    if (label) {
      if (m.byLabel[label]) return m.byLabel[label];
      // Fuzzy contains on word boundaries (so "city" never matches inside
      // "citizenship"), and only when every hit points at the same resolver.
      const padded = ` ${label} `;
      const hits = Object.keys(m.byLabel).filter((k) => padded.includes(` ${k} `));
      if (hits.length) {
        // Most specific alias wins: "gpa 3 0 or above" must beat "gpa".
        hits.sort((a, b) => b.length - a.length);
        const top = hits.filter((k) => k.length === hits[0].length);
        const resolvers = new Set(top.map((k) => String(m.byLabel[k])));
        if (resolvers.size === 1) return m.byLabel[top[0]];
      }
    }
    return null; // never guess into a field
  }

  function resolve(resolver, f) {
    try { return resolver(P(), f); } catch (e) { return null; }
  }

  const truthy = (v) => v === true ||
    ["yes", "true", "y", "checked", "1"].includes(D().norm(String(v)));

  // -------------------------------------------------------------------------
  // Fillers (each returns true if it filled something)
  // -------------------------------------------------------------------------
  function fillText(f, value, { overwrite = false } = {}) {
    const el = f.el;
    if (!overwrite && el.value && el.value.trim()) return false; // never clobber
    if (el.value === String(value)) return false;
    D().setNativeValue(el, String(value));
    D().flash(el);
    return true;
  }

  // Reusable custom-dropdown helper: open trigger → wait for listbox options
  // → click the option whose normalized text matches.
  async function fillDropdown(f, value) {
    const d = D(), m = M();
    const btn = f.el;
    const current = d.norm(btn.textContent);
    if (!m.placeholders.has(current)) {
      // Already answered. One exception: a mapped yes/no question holding
      // the OPPOSITE of the resolved answer gets corrected — drafts are
      // system-written and profile.js is the canon.
      const curW = current.split(" ")[0];
      const wantW = d.norm(value).split(" ")[0];
      const flip = (curW === "yes" && wantW === "no")
                || (curW === "no" && wantW === "yes");
      if (!flip) return false;
      // This widget class ACCEPTS synthetic clicks visually but never
      // commits them — corrections go straight to the trusted driver.
      d.log("correcting bool answer (driver):", (f.label || "").slice(0, 50),
            current, "->", String(value));
      btn.setAttribute("data-wdaf-retry", String(value));
      return false;
    }
    d.simClick(btn);
    const list = await d.waitFor(
      '[role="listbox"], [data-automation-id="promptOption"], [role="option"]', 2000);
    if (!list) return false;
    await d.settle();
    const opt = findOption(value);
    if (!opt) {
      closePopup(btn);
      d.log("dropdown: no option matched", value, "for", f.automationId || f.label);
      return false;
    }
    const optText = (opt.textContent || "").trim();
    d.simClick(opt);
    await d.settle();
    if (m.placeholders.has(d.norm(btn.textContent))) {
      // Synthetic click didn't register on this widget — flag it with the
      // resolved option text so the Playwright driver can click for real.
      btn.setAttribute("data-wdaf-retry", optText);
      d.log("dropdown: click unverified — flagged for driver:", optText);
      closePopup(btn);
      return false;
    }
    D().flash(btn);
    return true;
  }

  function findOption(value) {
    const d = D(), m = M();
    const opts = [...document.querySelectorAll(
      '[data-automation-id="promptOption"], [role="option"], ul[role="listbox"] li')]
      .filter((o) => d.isVisible(o) && d.norm(o.textContent));
    if (!opts.length) return null;
    const wanted = [d.norm(value), ...(m.optionSynonyms[d.norm(value)] || [])];
    for (const target of wanted) {
      let hit = opts.find((o) => d.norm(o.textContent) === target)
        || opts.find((o) => d.norm(o.textContent).startsWith(target));
      if (!hit) {
        const contains = opts.filter((o) =>
          d.norm(o.textContent).includes(target) || target.includes(d.norm(o.textContent)));
        if (contains.length === 1) hit = contains[0];
      }
      if (hit) return hit;
    }
    return null;
  }

  function closePopup(btn) {
    try {
      btn.dispatchEvent(new KeyboardEvent("keydown",
        { key: "Escape", bubbles: true, cancelable: true }));
      document.body.click();
    } catch (e) { /* best effort */ }
  }

  function fillCheckbox(f, value) {
    const want = truthy(value);
    if (f.el.checked === want) return false;
    D().simClick(D().clickTargetFor(f.el)); // click the label, not the input
    D().flash(f.el);
    return true;
  }

  function fillRadioGroup(f, value) {
    const d = D(), m = M();
    const wanted = [d.norm(value), ...(m.optionSynonyms[d.norm(value)] || [])];
    // The option's OWN visible text ("Yes"/"No") first — labelFor's junk
    // filter rightly rejects those strings for dropdowns, but for a radio
    // option they ARE the label.
    const labeled = f.radios.map((r) => ({
      r, lbl: d.norm((d.clickTargetFor(r).textContent || ""))
              || d.norm(d.labelFor(r)),
    })).filter((x) => x.lbl);
    // Exact-first ACROSS the whole group, then prefix, then contains —
    // otherwise "Male" would contains-match the "Female" option first.
    for (const test of [
      (lbl, t) => lbl === t,
      (lbl, t) => lbl.startsWith(t),
      (lbl, t) => t && lbl.includes(t),
    ]) {
      for (const target of wanted) {
        const hit = labeled.find((x) => test(x.lbl, target));
        if (hit) {
          if (hit.r.checked) return false;
          d.simClick(d.clickTargetFor(hit.r));
          d.flash(hit.r.closest('[data-automation-id="radioBtn"]') || hit.r);
          return true;
        }
      }
    }
    return false;
  }

  // Accepts "MM/YYYY", "MM/DD/YYYY", or "YYYY".
  function parseDate(value) {
    const parts = String(value).split("/").map((s) => s.trim());
    if (parts.length === 3) return { m: parts[0], d: parts[1], y: parts[2] };
    if (parts.length === 2) return { m: parts[0], y: parts[1] };
    if (parts.length === 1 && /^\d{4}$/.test(parts[0])) return { y: parts[0] };
    return null;
  }

  const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Best-effort calendar-popup fallback for MM/YYYY widgets whose segments
  // reject synthetic input (anatomy: monthPicker year spinner + 12 tiles).
  async function pickerFallback(wrapper, dt) {
    const d = D();
    const icon = wrapper.querySelector('[data-automation-id="dateIcon"]');
    if (!icon || !dt.y) return false;
    d.simClick(icon);
    const pop = await d.waitFor(() => document.querySelector(
      '[data-automation-id="monthPicker"]'), 1500);
    if (!pop) return false;
    for (let i = 0; i < 45; i++) {
      const lbl = document.querySelector(
        '[data-automation-id="monthPickerSpinnerLabel"]');
      if (!lbl) break;
      const y = parseInt(lbl.textContent, 10);
      if (!y || y === +dt.y) break;
      d.simClick(document.querySelector(`[data-automation-id="${
        y < +dt.y ? "monthPickerRightSpinner" : "monthPickerLeftSpinner"}"]`));
      await d.waitFor(() => parseInt(lbl.textContent, 10) !== y, 400);
    }
    const tiles = [...document.querySelectorAll(
      '[data-automation-id="monthPickerTileLabel"]')];
    const want = dt.m ? MONTH_ABBR[parseInt(dt.m, 10) - 1] : String(dt.y);
    const tile = tiles.find((t) => t.textContent.trim() === want);
    if (!tile) return false;
    d.simClick(tile);
    await d.settle();
    return true;
  }

  async function fillDate(f, value, { overwrite = false } = {}) {
    const d = D();
    const dt = parseDate(value);
    if (!dt) return false;
    const wrapper = f.el;
    const q = (name) => wrapper.querySelector(
      `input[data-automation-id="dateSection${name}-input"]`);
    // Sequential, with a FRESH query per segment: setting one segment makes
    // React re-render the widget, so nodes captured earlier go stale — the
    // old batch write left month committed and year on a dead node
    // ("Invalid Date: 02/" wall, seen live 2026-09-02).
    const wantSegs = [["Month", dt.m], ["Day", dt.d], ["Year", dt.y]];
    let did = false;
    for (const [name, val] of wantSegs) {
      const input = q(name);
      if (!input || !val) continue;
      if (!overwrite && input.value && input.value.trim()) continue;
      d.setNativeValue(input, String(parseInt(val, 10)));
      did = true;
      await d.settle();
    }
    // Verify on fresh nodes only.
    const bad = wantSegs.some(([name, val]) => {
      const input = q(name);
      return input && val &&
        String(input.value).trim() !== String(parseInt(val, 10));
    });
    if (bad) {
      if (await pickerFallback(wrapper, dt)) {
        const stillBad = wantSegs.some(([name, val]) => {
          const input = q(name);
          return input && val &&
            String(input.value).trim() !== String(parseInt(val, 10));
        });
        if (!stillBad) { d.flash(wrapper); return true; }
      }
      wrapper.setAttribute("data-wdaf-date", String(value));
      d.log("date: segments unverified — flagged for driver", String(value));
      return false;
    }
    if (!did) {
      // Some tenants render a single MM/YYYY input instead of segments
      const single = wrapper.querySelector("input");
      if (single && (overwrite || !single.value.trim())) {
        d.setNativeValue(single, String(value));
        did = true;
      }
    }
    if (did) d.flash(wrapper);
    return did;
  }

  // Multiselect search prompt (school, skills, field of study): type, WAIT
  // for the async suggestions, click the real option, VERIFY the chip.
  // Free text left in the box LOOKS filled but never commits server-side —
  // that's the "found it once I clicked around" bug (2026-09-02).
  async function fillSearchPrompt(container, value) {
    const d = D();
    const q = () => container.querySelector(
      'input[data-automation-id="searchBox"], input');
    const committed = () => !!container.querySelector(
      '[data-automation-id="selectedItem"]');
    let input = q();
    if (!input) return false;
    if (committed()) return false; // already answered
    d.simClick(input);
    await d.settle();
    input = q() || input;
    d.setNativeValue(input, String(value));
    // suggestions load asynchronously — give them a real chance
    let opt = await d.waitFor(() => findOption(value), 4000);
    if (!opt) {
      input.dispatchEvent(new KeyboardEvent("keydown",
        { key: "Enter", bubbles: true, cancelable: true }));
      opt = await d.waitFor(() => findOption(value), 2500);
    }
    if (opt) d.simClick(opt);
    const ok = await d.waitFor(committed, 2500);
    if (!ok) {
      closePopup(input);
      d.log("search-prompt: no committed chip for", String(value));
      return false;
    }
    d.flash(container);
    return true;
  }

  // -------------------------------------------------------------------------
  // Repeating sections: Work Experience / Education
  // -------------------------------------------------------------------------
  async function fillRepeatingSections(stats) {
    const p = P();
    await fillSection("workExperience",
      (p.experience || []).filter((e) => e.include !== false),
      fillExperienceBlock, stats);
    await fillSection("education",
      (p.education || []).filter((e) => e.include !== false),
      fillEducationBlock, stats);
  }

  // Some tenants (MMC, Micron) render experience blocks WITHOUT
  // workExperience-N ids — discover block roots from field labels instead:
  // walk up from each anchor-labeled field to the smallest ancestor that
  // also holds a mate-labeled field but only ONE anchor.
  function blocksByLabel(anchorRe, mateRe) {
    const d = D();
    const ffs = [...document.querySelectorAll('[data-automation-id*="formField"]')];
    const anchors = ffs.filter(
      (f) => d.isVisible(f) && anchorRe.test(d.norm(f.textContent || "")));
    const roots = [];
    for (const a of anchors) {
      let n = a, best = null;
      for (let i = 0; i < 10 && n; i++) {
        const inner = n.querySelectorAll
          ? [...n.querySelectorAll('[data-automation-id*="formField"]')] : [];
        const nA = inner.filter((f) => anchorRe.test(d.norm(f.textContent || ""))).length;
        const nM = inner.filter((f) => mateRe.test(d.norm(f.textContent || ""))).length;
        if (nA > 1) break; // crossed into the whole-section root
        if (nA === 1 && nM >= 1) best = n;
        n = n.parentElement;
      }
      if (best && !roots.includes(best)) roots.push(best);
    }
    return roots;
  }

  async function fillSection(key, entries, blockFiller, stats) {
    const d = D();
    if (!entries.length) return;
    const blockSel = `[data-automation-id^="${key}-"]`;
    const labelArgs = key === "workExperience"
      ? [/^job title/, /company/]
      : [/^school or university|^school\b|^university/, /degree|field of study/];
    let blocks = [...document.querySelectorAll(blockSel)];
    let labelMode = false;
    if (!blocks.length) {
      blocks = blocksByLabel(...labelArgs);
      labelMode = blocks.length > 0;
      if (labelMode) d.log(`${key}: ${blocks.length} label-driven block(s)`);
    }
    if (labelMode) {
      // Add blocks until one per profile entry — recount via blocksByLabel
      // (NEVER the id selector: id-recount here once spawned 2->4->6 empty
      // blocks on Guidehouse because it always saw 0).
      const kw = key === "workExperience" ? "experience" : "education";
      let guard = 0;
      while (blocks.length < entries.length && guard++ < entries.length + 2) {
        const addBtn = [...document.querySelectorAll("button")]
          .filter((b) => d.isVisible(b))
          .filter((b) => d.norm(b.textContent).startsWith("add"))
          .sort((a, b) =>
            (d.norm(b.textContent).includes(kw) ? 1 : 0) -
            (d.norm(a.textContent).includes(kw) ? 1 : 0))[0];
        if (!addBtn) break;
        const before = blocks.length;
        d.simClick(addBtn);
        await d.waitFor(
          () => blocksByLabel(...labelArgs).length > before, 2500);
        blocks = blocksByLabel(...labelArgs);
        if (blocks.length === before) break; // Add didn't take — bail
      }
      const n = Math.min(entries.length, blocks.length);
      for (let i = 0; i < n; i++) {
        try { await blockFiller(blocks[i], entries[i], stats); }
        catch (e) { D().log(`${key} label block ${i} failed`, e); stats.skipped++; }
      }
      return;
    }
    const section = blocks[0]
      ? blocks[0].closest(`[data-automation-id="${key}Section"]`) || blocks[0].parentElement.closest("div")
      : document.querySelector(`[data-automation-id="${key}Section"]`);
    if (!section && !blocks.length) return; // section not on this step

    // Click Add / Add Another until we have one block per profile entry
    let guard = 0;
    while (blocks.length < entries.length && guard++ < entries.length + 2) {
      const scope = section || document;
      const addBtn = [...scope.querySelectorAll(
        'button[data-automation-id="add-button"], button[data-automation-id="Add"], button[data-automation-id="Add Another"]')]
        .concat([...scope.querySelectorAll("button")].filter((b) =>
          d.norm(b.textContent).startsWith("add")))  // "Add Work Experience"
        .find(d.isVisible);
      if (!addBtn) break;
      const before = blocks.length;
      d.simClick(addBtn);
      await d.waitFor(() => document.querySelectorAll(blockSel).length > before, 2000);
      blocks = [...document.querySelectorAll(blockSel)];
      if (blocks.length === before) break; // Add didn't take — bail cleanly
    }

    const n = Math.min(entries.length, blocks.length);
    for (let i = 0; i < n; i++) {
      try { await blockFiller(blocks[i], entries[i], stats); }
      catch (e) { D().log(`${key} block ${i} failed`, e); stats.skipped++; }
    }
  }

  // Blocks OVERWRITE by design: Workday's resume parser mangles dates, and
  // profile.js is the canonical record (see workday-profile.txt).
  async function fillExperienceBlock(block, entry, stats) {
    const d = D();
    const put = (aid, val, labelRe) => {
      let el = block.querySelector(`[data-automation-id="${aid}"]`);
      if (!el && labelRe) {
        // label-driven tenants: find the field by its formField label text
        const ff = [...block.querySelectorAll('[data-automation-id*="formField"]')]
          .find((f) => labelRe.test(d.norm(f.textContent || "")));
        el = ff && ff.querySelector(
          'input[type="text"], input:not([type]), textarea');
      }
      if (!el || val == null || val === "") return;
      try {
        if (fillText({ el }, val, { overwrite: true })) stats.filled++;
      } catch (e) { stats.skipped++; }
    };
    put("jobTitle", entry.title, /^job title/);
    put("company", entry.company, /^company/);
    put("location", entry.location, /^location/);
    put("description", (entry.bullets || []).map((b) => `• ${b}`).join("\n"),
        /role description|^description/);

    // "I currently work here" BEFORE dates — it hides the To field
    const cur = block.querySelector('input[data-automation-id="currentlyWorkHere"], input[type="checkbox"]');
    if (cur && cur.checked !== !!entry.current) {
      d.simClick(d.clickTargetFor(cur));
      d.flash(cur);
      stats.filled++;
      await d.settle();
    }

    const wrappers = [...block.querySelectorAll('[data-automation-id="dateInputWrapper"], [data-automation-id="dateSection"]')]
      .filter((w) => w.querySelector("input"));
    if (wrappers[0] && entry.startDate &&
        await fillDate({ el: wrappers[0] }, entry.startDate, { overwrite: true })) stats.filled++;
    if (!entry.current && wrappers[1] && entry.endDate &&
        await fillDate({ el: wrappers[1] }, entry.endDate, { overwrite: true })) stats.filled++;
  }

  async function fillEducationBlock(block, entry, stats) {
    const d = D();
    const q = (aid) => block.querySelector(`[data-automation-id="${aid}"]`);
    // label-driven fallback for tenants without education field ids
    const byLabel = (re, sel) => {
      const ff = [...block.querySelectorAll('[data-automation-id*="formField"]')]
        .find((x) => re.test(d.norm(x.textContent || "")));
      return ff ? ff.querySelector(
        sel || 'input, textarea, button[aria-haspopup="listbox"]') : null;
    };
    const isSearchy = (el) => {
      const ff = el.closest('[data-automation-id^="formField"]');
      return el.getAttribute("data-automation-id") === "searchBox" ||
        !!(ff && ff.querySelector('input[data-automation-id="searchBox"], '
                                  + '[data-automation-id="selectedItemList"]'));
    };

    const school = q("school") || q("schoolName")
      || byLabel(/^school or university|^school\b|^university/);
    if (school && entry.school) {
      try {
        if (school.tagName === "BUTTON") {
          if (await fillDropdown({ el: school }, entry.school)) stats.filled++;
        } else if (isSearchy(school)) {
          // search-multiselect: typed text never commits — pick the option
          const container = school.closest('[data-automation-id^="formField"]')
            || school.parentElement;
          if (await fillSearchPrompt(container, entry.school)) stats.filled++;
        } else if (fillText({ el: school }, entry.school, { overwrite: true })) stats.filled++;
      } catch (e) { stats.skipped++; }
    }

    const degree = q("degree") || q("degreeDropdown") || byLabel(/^degree/);
    if (degree && entry.degree) {
      try { if (await fillDropdown({ el: degree }, entry.degree)) stats.filled++; }
      catch (e) { stats.skipped++; }
    }

    const fos = q("field-of-study") || q("fieldOfStudy")
      || byLabel(/^field of study/);
    if (fos && entry.fieldOfStudy) {
      try {
        const container = fos.closest('[data-automation-id^="formField"]') || fos;
        if (await fillSearchPrompt(container, entry.fieldOfStudy)) stats.filled++;
      } catch (e) { stats.skipped++; }
    }

    const gpa = q("gpa") || q("gradeAverage")
      || byLabel(/gpa|grade point/, "input");
    if (gpa && entry.gpa) {
      try { if (fillText({ el: gpa }, entry.gpa, { overwrite: true })) stats.filled++; }
      catch (e) { stats.skipped++; }
    }

    const years = [...block.querySelectorAll('[data-automation-id="dateInputWrapper"], [data-automation-id="dateSection"]')]
      .filter((w) => w.querySelector("input"));
    if (years[0] && entry.startDate &&
        await fillDate({ el: years[0] }, entry.startDate, { overwrite: true })) stats.filled++;
    if (years[1] && entry.endDate &&
        await fillDate({ el: years[1] }, entry.endDate, { overwrite: true })) stats.filled++;

    const descr = q("activities") || q("description");
    if (descr && entry.description) {
      try { if (fillText({ el: descr }, entry.description, { overwrite: true })) stats.filled++; }
      catch (e) { stats.skipped++; }
    }
  }

  // -------------------------------------------------------------------------
  // Skills — only when the page actually shows a Skills prompt
  // -------------------------------------------------------------------------
  async function fillSkillsSection(stats) {
    const d = D(), p = P();
    const list = (p.skills || []).slice(0, 12);
    if (!list.length) return;
    const findBox = () => [...document.querySelectorAll(
        '[data-automation-id*="formField"]')]
      .find((x) => d.isVisible(x) &&
            /^skills\b/.test(d.norm(x.textContent || "")) &&
            x.querySelector('input[data-automation-id="searchBox"], input'));
    let box = findBox();
    if (!box) return; // tenant doesn't ask for skills — nothing to do
    const have = () => [...box.querySelectorAll(
        '[data-automation-id="selectedItem"]')]
      .map((s) => d.norm(s.textContent));
    if (have().length >= 5) return; // already populated
    for (const skill of list) {
      box = findBox() || box;
      if (have().some((h) => h.includes(d.norm(skill)))) continue;
      try {
        // fillSearchPrompt skips containers that already hold a chip —
        // skills are MULTI, so bypass that guard by using the raw flow
        const input = box.querySelector(
          'input[data-automation-id="searchBox"], input');
        if (!input) break;
        d.simClick(input);
        await d.settle();
        d.setNativeValue(input, String(skill));
        let opt = await d.waitFor(() => findOption(skill), 2500);
        if (!opt) {
          input.dispatchEvent(new KeyboardEvent("keydown",
            { key: "Enter", bubbles: true, cancelable: true }));
          opt = await d.waitFor(() => findOption(skill), 1500);
        }
        if (opt) { d.simClick(opt); stats.filled++; }
        await d.settle();
      } catch (e) { stats.skipped++; }
    }
    d.flash(box);
  }

  // -------------------------------------------------------------------------
  // Learning mode — remember every field we could not map
  // -------------------------------------------------------------------------
  async function recordUnmapped(items) {
    if (!items.length || typeof chrome === "undefined" || !chrome.storage?.local) return;
    try {
      const { wdaf_unmapped = {} } = await chrome.storage.local.get("wdaf_unmapped");
      for (const it of items) {
        const key = `${it.host}::${it.automationId || it.label}`;
        const prev = wdaf_unmapped[key] || { count: 0 };
        wdaf_unmapped[key] = { ...it, count: prev.count + 1, lastSeen: Date.now() };
      }
      await chrome.storage.local.set({ wdaf_unmapped });
    } catch (e) { D().log("recordUnmapped failed", e); }
  }

  async function dumpUnmapped() {
    const { wdaf_unmapped = {} } = await chrome.storage.local.get("wdaf_unmapped");
    const items = Object.values(wdaf_unmapped)
      .sort((a, b) => (b.count || 0) - (a.count || 0));
    if (!items.length) {
      console.log("[WDAF] No unmapped fields recorded. 100% hit rate so far.");
      return 0;
    }
    console.group(`[WDAF] ${items.length} unmapped fields — paste lines into src/mappings.js`);
    console.log("---- byAutomationId candidates ----");
    for (const it of items.filter((i) => i.automationId)) {
      console.log(`'${it.automationId}': p => "",  // label: "${(it.label || "").trim()}" | ${it.kind} | ${it.host} | seen ${it.count}×`);
    }
    console.log("---- byLabel candidates (no automation id) ----");
    for (const it of items.filter((i) => !i.automationId && i.label)) {
      console.log(`'${WDAF.dom.norm(it.label)}': p => "",  // ${it.kind} | ${it.host} | seen ${it.count}×`);
    }
    console.groupEnd();
    return items.length;
  }

  async function clearUnmapped() {
    await chrome.storage.local.remove("wdaf_unmapped");
    console.log("[WDAF] Unmapped-field log cleared.");
  }

  // -------------------------------------------------------------------------
  // Main entry: fill the current step
  // -------------------------------------------------------------------------
  async function fillStep() {
    if (filling) return lastStats;
    // A calendar popup means the driver is mid-interaction with a date
    // widget — a fill pass now re-renders React and closes the popup.
    if (document.querySelector('[data-automation-id="datePicker"]')) {
      D().log("fill deferred: datePicker popup open");
      return lastStats;
    }
    filling = true;
    const stats = { filled: 0, skipped: 0, unmapped: [] };
    try {
      applyOverrides();
      await fillRepeatingSections(stats);
      await fillSkillsSection(stats);

      for (const f of collectFields()) {
        try {
          const resolver = matchField(f);
          if (!resolver) {
            if (f.automationId || f.label) {
              stats.unmapped.push({
                automationId: f.automationId, label: f.label,
                kind: f.kind, host: location.hostname,
              });
              D().log("unmapped:", f.automationId || f.label, `(${f.kind})`);
            }
            stats.skipped++;
            continue;
          }
          const value = resolve(resolver, f);
          if (value == null || value === "" ||
              (f.kind !== "checkbox" && typeof value === "boolean" && !value)) {
            stats.skipped++;
            continue;
          }
          let ok = false;
          if (f.kind === "text" || f.kind === "textarea") ok = fillText(f, value);
          else if (f.kind === "dropdown")   ok = await fillDropdown(f, value);
          else if (f.kind === "checkbox")   ok = fillCheckbox(f, value);
          else if (f.kind === "radiogroup") ok = fillRadioGroup(f, value);
          else if (f.kind === "date")       ok = await fillDate(f, value);
          if (ok) stats.filled++;
          else {
            stats.skipped++;
            if (f.kind !== "text" && f.kind !== "textarea") {
              D().log("fill-miss:", (f.label || f.automationId || "").slice(0, 60),
                      `(${f.kind})`, "val=", String(value).slice(0, 30));
            }
          }
        } catch (e) {
          D().log("field failed:", f.automationId || f.label, e);
          stats.skipped++;
        }
      }
      await recordUnmapped(stats.unmapped);
      lastStats = { filled: stats.filled, skipped: stats.skipped };
      return stats;
    } finally {
      filling = false;
      // Signal for external drivers (autopilot polls this from the page world)
      try {
        document.documentElement.setAttribute("data-wdaf-last-fill", String(Date.now()));
        document.documentElement.setAttribute("data-wdaf-stats",
          JSON.stringify({ filled: stats.filled, skipped: stats.skipped,
                           unmapped: stats.unmapped.length }));
        // Full unmapped list for the autopilot to harvest to unmapped.jsonl
        document.documentElement.setAttribute("data-wdaf-unmapped",
          JSON.stringify(stats.unmapped.slice(0, 40)));
      } catch (e) { /* cosmetic */ }
    }
  }

  return {
    fillStep, dumpUnmapped, clearUnmapped,
    isFilling: () => filling,
    lastStats: () => lastStats,
  };
})();
