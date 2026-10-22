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

  // Repeating-entry blocks. `data-wdaf-block` is stamped by fillSection on
  // tenants that render blocks WITHOUT workExperience-N / education-N ids —
  // without it those blocks' fields (Job Title, Company, From, Role
  // Description…) leak into the generic pass, where they are meaningless
  // out of context and only ever showed up as noise in the unmapped log.
  const BLOCK_SEL = '[data-automation-id^="workExperience-"], [data-automation-id^="education-"], [data-wdaf-block]';

  // Page furniture that happens to be a listbox button — never a question.
  const NON_FORM_DROPDOWNS = new Set(["utilityMenuButton", "languageSelector"]);

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
      if (!d.isVisible(el) || inBlock(el)) continue;
      if (NON_FORM_DROPDOWNS.has(el.getAttribute("data-automation-id"))) continue;
      const dsc = desc("dropdown", el);
      // Chrome/page furniture (account menu, language switcher) is a listbox
      // button too, but it lives outside any form field and has no label.
      if (!dsc.label && !el.closest('[data-automation-id*="formField"]')) continue;
      out.push(dsc);
    }

    // Radio groups, keyed by input name
    const groups = new Map();
    for (const r of document.querySelectorAll('input[type="radio"]')) {
      if (inBlock(r) || !d.isVisible(d.clickTargetFor(r))) continue;
      const key = r.name
        || r.closest('fieldset, [role="radiogroup"], [data-automation-id^="formField"]') || r;
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

    // Prompt / multiselect widgets ("How Did You Hear About Us?" on many
    // tenants). These have no listbox button and their input is a searchBox,
    // which the loop above skips — so they were invisible to the engine and
    // the answer went in as TYPED TEXT that never commits (live 2026-09-10).
    for (const ff of document.querySelectorAll('[data-automation-id*="formField"]')) {
      if (inBlock(ff) || !d.isVisible(ff)) continue;
      if (ff.querySelector('button[aria-haspopup="listbox"]')) continue; // plain dropdown
      const isPrompt = ff.querySelector('input[data-automation-id="searchBox"]')
        || ff.querySelector('[data-automation-id="selectedItemList"], '
                            + '[data-automation-id="multiselectInputContainer"], '
                            + '[data-automation-id="promptIcon"]');
      if (!isPrompt) continue;
      const dsc = desc("prompt", ff);
      // Skills and the in-block school/field-of-study prompts have their own
      // fillers — they must not be answered twice.
      if (/^skills\b|type to add skills/.test(d.norm(dsc.label))) continue;
      out.push(dsc);
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
      const hits = Object.keys(m.byLabel).filter((k) =>
        !(m.exactOnly && m.exactOnly.has(k)) && padded.includes(` ${k} `));
      if (hits.length) {
        // Most specific alias wins: "gpa 3 0 or above" must beat "gpa".
        hits.sort((a, b) => b.length - a.length);
        const top = hits.filter((k) => k.length === hits[0].length);
        const resolvers = new Set(top.map((k) => String(m.byLabel[k])));
        if (resolvers.size === 1) return m.byLabel[top[0]];
      }
    }
    // Shape-based rules last (technology-list checkboxes, …). Explicit
    // patterns only — they still answer strictly from the profile.
    for (const rule of (m.byPattern || [])) {
      try { if (rule.test(f)) return rule.resolve; } catch (e) { /* next rule */ }
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

  // Every shape an option row takes across tenants: Workday's own ids, ARIA
  // roles, plain list items, and the radio-style rows the Field of Study
  // prompt uses.
  const OPTION_SEL = '[data-automation-id="promptOption"], '
    + '[data-automation-id="promptLeafNode"], [data-automation-id="promptOptionSingleLabel"], '
    + '[role="option"], [role="radio"], [role="menuitem"], [role="treeitem"], '
    + 'ul[role="listbox"] li';

  function findOption(value) {
    const d = D(), m = M();
    const opts = [...document.querySelectorAll(OPTION_SEL)]
      .filter((o) => d.isVisible(o) && d.norm(o.textContent))
      // A prompt's rows can BE radios, but a form's own Yes/No radio group
      // must never be mistaken for an open dropdown's options.
      .filter((o) => o.getAttribute("role") !== "radio"
        || !o.closest('[role="radiogroup"], fieldset')
        || !!o.closest('[role="listbox"], [data-automation-id="promptOptions"], '
                       + '[data-automation-id="activeListContainer"]'));
    if (!opts.length) return null;
    const wanted = [d.norm(value), ...(m.optionSynonyms[d.norm(value)] || [])];
    for (const target of wanted) {
      let hit = opts.find((o) => d.norm(o.textContent) === target)
        || opts.find((o) => prefixWord(d.norm(o.textContent), target));
      if (!hit) {
        const contains = opts.filter((o) => {
          const t = d.norm(o.textContent);
          return containsWord(t, target) || containsWord(target, t);
        });
        if (contains.length === 1) hit = contains[0];
      }
      if (hit) return hit;
    }
    return null;
  }

  // Option text matching on WORD boundaries (norm() turns punctuation into
  // spaces): "no" must not prefix-match "None" / "Not applicable", "R" must
  // not match "Ruby", and contains-matching needs a whole word of 3+ chars
  // ("y" used to hit "prefer not to sa-y").
  const prefixWord = (lbl, t) => !!t && (lbl === t || lbl.startsWith(t + " "));
  const containsWord = (lbl, t) => !!t && t.length >= 3 && ` ${lbl} `.includes(` ${t} `);

  function closePopup(btn) {
    try {
      btn.dispatchEvent(new KeyboardEvent("keydown",
        { key: "Escape", bubbles: true, cancelable: true }));
      document.body.click();
    } catch (e) { /* best effort */ }
  }

  // Checkboxes get a ladder, because one click is not enough on every
  // tenant: the CC-305 self-identify boxes and some consent boxes ignore a
  // synthetic click on the label but commit on Space. Each rung is VERIFIED
  // before moving on, and a box that still won't move is flagged rather than
  // reported as filled.
  async function fillCheckbox(f, value) {
    const d = D();
    const el = f.el;
    // Tick only, never untick: a "No"/false answer leaves the box alone, so a
    // box the user ticked by hand ("I do not want to answer") survives a refill.
    const want = truthy(value);
    if (!want || el.checked) return false;
    const rungs = [
      () => d.simClick(d.clickTargetFor(el)), // the visible label
      () => d.simClick(el),                   // the input itself
      () => {                                 // keyboard: Space toggles it
        try { el.focus(); } catch (e) { /* non-focusable */ }
        for (const type of ["keydown", "keypress", "keyup"]) {
          el.dispatchEvent(new KeyboardEvent(type, {
            key: " ", code: "Space", keyCode: 32, which: 32,
            bubbles: true, cancelable: true,
          }));
        }
      },
    ];
    for (const rung of rungs) {
      try { rung(); } catch (e) { /* try the next one */ }
      await d.settle();
      if (el.checked) { d.flash(el); return true; }
    }
    el.setAttribute("data-wdaf-retry", "check");
    d.log("checkbox did not commit:", (f.label || "").slice(0, 55));
    return false;
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
      prefixWord,
      containsWord,
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
    const yLbl = document.querySelector(
      '[data-automation-id="monthPickerSpinnerLabel"]');
    if (dt.m && (!yLbl || parseInt(yLbl.textContent, 10) !== +dt.y)) {
      closePopup(icon);  // a month tile now would commit the WRONG year
      return false;
    }
    const tiles = [...document.querySelectorAll(
      '[data-automation-id="monthPickerTileLabel"]')];
    const want = dt.m ? MONTH_ABBR[parseInt(dt.m, 10) - 1] : String(dt.y);
    const tile = tiles.find((t) => t.textContent.trim() === want);
    if (!tile) { closePopup(icon); return false; }
    d.simClick(tile);
    await d.settle();
    return true;
  }

  const MONTH_FULL = ["january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"];

  // Full-date calendar popup (CC-305 "Date", and any MM/DD/YYYY widget).
  // The segmented inputs on these are DECOYS — tabindex -1 under aria-hidden
  // wrappers — so no amount of typing reaches React state. Clicking a day
  // cell is the only path that commits. Selectors fall back to structure so a
  // tenant that themes or renames its picker still works.
  async function dayPickerFallback(wrapper, dt) {
    const d = D();
    if (!dt.m || !dt.d || !dt.y) return false;
    const icon = wrapper.querySelector('[data-automation-id="dateIcon"]')
      || wrapper.querySelector('button, [role="button"], svg, img');
    if (!icon) return false;

    // Clear whatever garbage is in the field FIRST. The popup opens on the
    // month the widget's state holds, so a half-written "09//" from an
    // earlier attempt is what strands it on September 2009 — 204 months of
    // walking away from today. Cleared, it opens on the current month.
    for (const seg of wrapper.querySelectorAll("input")) {
      if (String(seg.value).trim()) {
        try { d.setNativeValue(seg, ""); } catch (e) { /* keep going */ }
      }
    }
    await d.settle();
    d.simClick(icon);

    // Re-query the popup EVERY time: React pickers replace the whole popup
    // on each month change, and a captured node goes stale after one hop —
    // the walk then reads a detached header forever (160s hang, caught in
    // the fixture 2026-09-10).
    const popupNow = () =>
      document.querySelector('[data-automation-id="datePicker"]')
      || [...document.querySelectorAll('[role="dialog"], [role="application"], [class*="atePicker"], [class*="alendar"]')]
           .find((n) => d.isVisible(n) && dayCells(n).length >= 20)
      || null;

    const popup = await d.waitFor(popupNow, 2500);
    if (!popup) return false;

    const header = () => {
      const popup = popupNow();
      if (!popup) return null;
      const h = popup.querySelector('[data-automation-id="datePickerMonth"]');
      const txt = h ? h.textContent
        : ([...popup.querySelectorAll("*")]
            .map((n) => (n.children.length ? "" : (n.textContent || "").trim()))
            .find((t) => /^[A-Za-z]+\s+\d{4}$/.test(t)) || "");
      const mm = MONTH_FULL.findIndex((n) => d.norm(txt).startsWith(n.slice(0, 3)));
      const yy = parseInt((txt.match(/\d{4}/) || [])[0], 10);
      return mm < 0 || !yy ? null : { m: mm + 1, y: yy, txt: txt.trim() };
    };

    const want = { m: parseInt(dt.m, 10), y: parseInt(dt.y, 10) };

    // "Today" is ambiguous — this Mac and the tenant's server can be a day
    // apart. If we're asking for today AND the popup already shows the
    // current month, the calendar's own today-marked cell is the authority.
    const now = new Date();
    const isToday = want.y === now.getFullYear() && want.m === now.getMonth() + 1
      && parseInt(dt.d, 10) === now.getDate();
    if (isToday) {
      const h0 = header();
      if (h0 && h0.m === want.m && h0.y === want.y) {
        const todayCell = (popupNow() || popup).querySelector(
          '[data-automation-id="datePickerSelectedToday"], [aria-current="date"]');
        if (todayCell) {
          d.simClick(todayCell);
          await d.settle();
          return true;
        }
      }
    }

    // Walk to the target month. The popup opens on whatever the widget's
    // React state holds — after a failed typing attempt that can be years
    // away (a live run opened on September 2009), so allow a long walk.
    const deadline = performance.now() + 25000; // never hang the page
    let stuck = 0;
    for (let i = 0; i < 400 && performance.now() < deadline; i++) {
      const now = header();
      if (!now) break;
      const delta = (want.y - now.y) * 12 + (want.m - now.m);
      if (delta === 0) break;
      const pop = popupNow();
      if (!pop) break;
      const nav = pop.querySelector(`[data-automation-id="${delta > 0 ? "nextControl" : "previousControl"}"]`)
        || navButton(pop, delta > 0);
      if (!nav) break;
      d.simClick(nav);
      const moved = await d.waitFor(() => {
        const h = header();
        return h && h.txt !== now.txt;
      }, 400);
      // Two dead clicks in a row means the arrows aren't driving this widget.
      if (!moved && ++stuck >= 2) { d.log("date picker: month nav not responding"); break; }
      if (moved) stuck = 0;
    }

    // Never click a day in the wrong month — that is how a walk that ran out
    // of budget silently wrote 6/10/2026 instead of 9/10/2026 (fixture,
    // 2026-09-10). If we didn't land on the target month, give up cleanly.
    const landed = header();
    if (!landed || landed.m !== want.m || landed.y !== want.y) {
      d.log("date picker: never reached", `${want.m}/${want.y}`,
            landed ? `(stopped on ${landed.txt})` : "(no header)");
      closePopup(icon);
      return false;
    }

    // aria-label ("Wednesday 23 September 2026") first: a bare "23" can be
    // the greyed PREVIOUS month's cell, which comes earlier in the grid.
    const wantDay = String(parseInt(dt.d, 10));
    const cells = dayCells(popupNow() || popup);
    const cell = cells.find((c) => {
      const lbl = d.norm(c.getAttribute("aria-label") || "");
      return !!lbl && lbl.includes(MONTH_FULL[want.m - 1])
        && new RegExp(`\\b${wantDay}\\b`).test(lbl);
    }) || cells.find((c) => !c.getAttribute("aria-label")
                     && (c.textContent || "").trim() === wantDay);
    if (!cell) { closePopup(icon); return false; }
    d.simClick(cell);
    await d.settle();
    return true;
  }

  // Day cells: Workday's own ids first, then any small numeric cell that is
  // not a greyed adjacent-month day.
  function dayCells(root) {
    const d = D();
    const byId = [...root.querySelectorAll(
      '[data-automation-id="datePickerDay"], [data-automation-id="datePickerSelectedToday"]')];
    if (byId.length) return byId;
    return [...root.querySelectorAll('td, [role="gridcell"], button, div')]
      .filter((n) => !n.children.length
        && /^\d{1,2}$/.test((n.textContent || "").trim())
        && n.getAttribute("aria-disabled") !== "true"
        && !/outside|adjacent|muted|disabled|other-?month/i.test(n.className || "")
        && d.isVisible(n));
  }

  function navButton(popup, forward) {
    const d = D();
    const btns = [...popup.querySelectorAll('button, [role="button"], svg')]
      .filter((b) => d.isVisible(b));
    const byLabel = btns.find((b) => {
      const t = d.norm((b.getAttribute("aria-label") || "") + " " + (b.title || ""));
      return forward ? /next|forward/.test(t) : /prev|previous|back/.test(t);
    });
    if (byLabel) return byLabel;
    // Header row convention: ‹ on the left, › on the right.
    const arrows = btns.filter((b) => (b.textContent || "").trim().length <= 2);
    return forward ? arrows[arrows.length - 1] : arrows[0];
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

    const segsOk = () => {
      const segs = wantSegs.filter(([name, val]) => val && q(name));
      if (segs.length) {
        return segs.every(([name, val]) =>
          String(q(name).value).trim() === String(parseInt(val, 10)));
      }
      const single = wrapper.querySelector("input");
      const txt = single ? String(single.value) : (wrapper.textContent || "");
      return (!dt.d || txt.includes(String(parseInt(dt.d, 10)))) && txt.includes(String(dt.y));
    };

    // FULL dates (MM/DD/YYYY) go through the calendar FIRST. On the CC-305
    // self-identify form the segment inputs are decoys — typing leaves
    // "Invalid Date: 09//" and a picker stranded on the wrong year, which is
    // exactly what a live run produced on 2026-09-10.
    if (dt.m && dt.d && dt.y && !segsOk()) {
      if (await dayPickerFallback(wrapper, dt) && segsOk()) {
        d.flash(wrapper);
        return true;
      }
    }

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
      // MM/YYYY widgets (experience dates) use the month-tile picker; full
      // dates get a second calendar attempt, since typing has now scrambled
      // the widget's state and the picker walk can still recover it.
      const recovered = (dt.m && dt.d && dt.y)
        ? await dayPickerFallback(wrapper, dt)
        : await pickerFallback(wrapper, dt);
      if (recovered && segsOk()) { d.flash(wrapper); return true; }
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

  // Prompt / multiselect field ("How Did You Hear About Us?"). Workday hides
  // the real answer behind a menu — typing the text in looks filled but never
  // commits, so this OPENS the widget and CLICKS the option, then proves a
  // chip landed. Hierarchical prompts (categories → leaves) are handled by
  // searching, which spans every level.
  async function fillPromptWidget(container, value) {
    const d = D(), m = M();
    const chip = () => container.querySelector('[data-automation-id="selectedItem"]');
    if (chip()) return false; // already answered
    const input = container.querySelector(
      'input[data-automation-id="searchBox"], input[type="text"], input:not([type])');
    const opener = input
      || container.querySelector('[data-automation-id="promptIcon"], button, [role="button"]');
    if (!opener) return false;

    const options = () => [...document.querySelectorAll(OPTION_SEL)].filter(d.isVisible);
    const openMenu = async () => {
      d.simClick(opener);
      return d.waitFor(() => (options().length ? true : null), 1500);
    };
    // Click one option and prove the answer stuck. A CATEGORY click looks
    // identical but lands no chip — the caller treats that as "go deeper".
    const pick = async (opt) => {
      const text = (opt.textContent || "").trim();
      d.simClick(opt);
      const ok = await d.waitFor(() => (chip()
        || d.norm(container.textContent).includes(d.norm(text))) ? text : null, 1500);
      return ok ? text : null;
    };

    await openMenu();
    await d.settle();
    let attempted = "";

    // 1. SEARCH first — Workday's prompt search spans every level of the
    //    tree, so it reaches a leaf that the top-level menu only shows as a
    //    category. Synonyms are tried in order, strongest first.
    if (input) {
      for (const term of [String(value), ...(m.optionSynonyms[d.norm(value)] || [])]) {
        d.setNativeValue(input, term);
        if (!options().length) await openMenu();
        const opt = await d.waitFor(() => findOption(term), 2000);
        if (!opt) continue;
        const landed = await pick(opt);
        if (landed) { d.flash(container); return true; }
        attempted = (opt.textContent || "").trim();
      }
      d.setNativeValue(input, "");
    }

    // 2. Otherwise walk the menu: a click that changes the list was a
    //    category, so look again inside it (Workday nests two levels).
    for (let depth = 0; depth < 3; depth++) {
      if (!options().length) await openMenu();
      const opt = findOption(value);
      if (!opt) break;
      const before = options().map((o) => o.textContent).join("|");
      const landed = await pick(opt);
      if (landed) { d.flash(container); return true; }
      attempted = (opt.textContent || "").trim();
      const drilled = await d.waitFor(
        () => (options().map((o) => o.textContent).join("|") !== before ? true : null), 1500);
      if (!drilled) break;
    }

    if (attempted) {
      // Same stubborn-widget class as the dropdowns: hand it to the driver.
      container.setAttribute("data-wdaf-retry", attempted);
      d.log("prompt: click unverified — flagged for driver:", attempted);
    } else {
      d.log("prompt: no option matched", String(value), "for",
            (d.labelFor(container) || "").slice(0, 50));
    }
    closePopup(opener);
    return false;
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

  // Some tenants render experience blocks WITHOUT
  // workExperience-N ids — discover block roots from field labels instead:
  // walk up from each anchor-labeled field to the smallest ancestor that
  // also holds a mate-labeled field but only ONE anchor.
  const MAX_BLOCK_FIELDS = 16; // one experience entry is ~7 form fields

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
        // With only ONE entry on the page nothing above ever holds a second
        // anchor, so the climb would run all the way to <body> and call the
        // whole form one block. Once we have a candidate, stop as soon as an
        // ancestor is bigger than any single entry could be.
        if (best && inner.length > MAX_BLOCK_FIELDS) break;
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

  // An EMPTY section renders nothing but a heading and an "Add" button —
  // no fields at all, so neither the id lookup nor the label lookup can see
  // it and the whole section was silently skipped (live, 2026-09-10: the user
  // had to click Add himself). Find the section by its heading and the Add
  // button that follows it.
  const SECTION_HEADINGS = {
    workExperience: /^work experience$|^employment( history)?$|^work history$/,
    education: /^education$|^education history$/,
  };

  function addButtonForSection(re) {
    const d = D();
    if (!re) return null;
    const headings = [...document.querySelectorAll(
      'h1, h2, h3, h4, h5, [role="heading"], legend, label, div, span, p')]
      .filter((n) => !n.children.length && d.isVisible(n)
                     && re.test(d.norm(n.textContent || "")));
    const adds = [...document.querySelectorAll('button, [role="button"]')]
      .filter((b) => d.isVisible(b) && /^add\b/.test(d.norm(b.textContent || "")));
    const otherHeads = [...document.querySelectorAll(
      'h1, h2, h3, h4, h5, [role="heading"]')].filter((n) => d.isVisible(n));

    for (const h of headings) {
      const after = adds.filter((b) =>
        h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const add = after[0];
      if (!add) continue;
      // Don't reach past the next section's heading and click ITS Add button.
      const crossed = otherHeads.some((o) =>
        o !== h
        && (h.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING)
        && (o.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (!crossed) return add;
    }
    return null;
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
    if (!blocks.length) {
      const add = addButtonForSection(SECTION_HEADINGS[key]);
      if (add) {
        d.log(`${key}: empty section — clicking Add`);
        d.simClick(add);
        await d.waitFor(() => (document.querySelectorAll(blockSel).length
          || blocksByLabel(...labelArgs).length) ? true : null, 3000);
        blocks = [...document.querySelectorAll(blockSel)];
        if (!blocks.length) {
          blocks = blocksByLabel(...labelArgs);
          labelMode = blocks.length > 0;
        }
      }
    }
    if (labelMode) {
      // Add blocks until one per profile entry — recount via blocksByLabel
      // (NEVER the id selector: id-recount here once spawned 2->4->6 empty
      // blocks on one tenant because it always saw 0).
      const kw = key === "workExperience" ? "experience" : "education";
      let guard = 0;
      while (blocks.length < entries.length && guard++ < entries.length + 2) {
        // Only THIS section's Add: a stray "Add" (Websites, Languages) spawns
        // an empty required block that then blocks Next.
        const addBtn = [...document.querySelectorAll("button")]
          .filter((b) => d.isVisible(b))
          .find((b) => /^add\b/.test(d.norm(b.textContent))
                       && d.norm(b.textContent).includes(kw))
          || addButtonForSection(SECTION_HEADINGS[key]);
        if (!addBtn) break;
        const before = blocks.length;
        d.simClick(addBtn);
        await d.waitFor(
          () => blocksByLabel(...labelArgs).length > before, 2500);
        blocks = blocksByLabel(...labelArgs);
        if (blocks.length === before) break; // Add didn't take — bail
      }
      // Stamp the roots so BLOCK_SEL sees them: everything inside belongs to
      // this entry and must not be matched as a standalone question.
      blocks.forEach((b, i) => {
        try { b.setAttribute("data-wdaf-block", `${key}-${i}`); } catch (e) { /* ok */ }
      });
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
    // the REAL box only — "any checkbox in the block" could toggle another
    const cur = block.querySelector('input[data-automation-id="currentlyWorkHere"]')
      || [...block.querySelectorAll('input[type="checkbox"]')].find((c) =>
           /currently work/.test(d.norm(d.labelFor(c) || d.clickTargetFor(c).textContent)));
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
    // Label-driven fallback for tenants without education field ids.
    // ORDER MATTERS: a dropdown's form field usually also contains a hidden
    // input, and querying `input` first handed fillDropdown that input
    // instead of the listbox button — which is why Degree stayed on "Select
    // One" with a required-field error on a live run (2026-09-10).
    const byLabel = (re, sel) => {
      const ff = [...block.querySelectorAll('[data-automation-id*="formField"]')]
        .find((x) => re.test(d.norm(x.textContent || "")));
      if (!ff) return null;
      if (sel) return ff.querySelector(sel);
      return ff.querySelector('button[aria-haspopup="listbox"]')
        || ff.querySelector('input[data-automation-id="searchBox"]')
        || [...ff.querySelectorAll("input, textarea")]
             .find((el) => el.type !== "hidden" && d.isVisible(el))
        || null;
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

    // "Degree" is a wildcard: most tenants list degrees (Bachelors, Masters,
    // Doctorate…) but some list MAJORS in that same dropdown. Try the degree
    // first and the field of study second — whichever the list actually
    // holds is the one that commits, and neither is a guess.
    const degree = q("degree") || q("degreeDropdown") || byLabel(/^degree/);
    if (degree && (entry.degree || entry.fieldOfStudy)) {
      for (const value of [entry.degree, entry.fieldOfStudy].filter(Boolean)) {
        try {
          const ok = degree.tagName === "BUTTON"
            ? await fillDropdown({ el: degree, label: "Degree" }, value)
            : await fillPromptWidget(
                degree.closest('[data-automation-id*="formField"]') || degree, value);
          if (ok) { stats.filled++; break; }
        } catch (e) { stats.skipped++; }
      }
    }

    const fos = q("field-of-study") || q("fieldOfStudy")
      || byLabel(/^field of study|^major\b/);
    if (fos && entry.fieldOfStudy) {
      try {
        const container = fos.closest('[data-automation-id*="formField"]') || fos;
        const ok = fos.tagName === "BUTTON"
          ? await fillDropdown({ el: fos, label: "Field of Study" }, entry.fieldOfStudy)
          : (await fillPromptWidget(container, entry.fieldOfStudy)
             || await fillSearchPrompt(container, entry.fieldOfStudy));
        if (ok) stats.filled++;
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
    // "Skills" is the heading on some tenants and "Type to Add Skills" is
    // the field's own label on others — match either (live 2026-09-10).
    const findBox = () => [...document.querySelectorAll(
        '[data-automation-id*="formField"]')]
      .find((x) => d.isVisible(x) &&
            /^skills\b|type to add skills|^add skills/.test(d.norm(x.textContent || "")) &&
            x.querySelector('input[data-automation-id="searchBox"], input'));
    let box = findBox();
    if (!box) return; // tenant doesn't ask for skills — nothing to do
    const have = () => [...box.querySelectorAll(
        '[data-automation-id="selectedItem"]')]
      .map((s) => d.norm(s.textContent));
    if (have().length >= 5) return; // already populated
    for (const skill of list) {
      box = findBox() || box;
      // Word-boundary match, not substring: plain `includes` made the chip
      // "scikit-learn" swallow the skill "R", which then never got added.
      const want = d.norm(skill);
      if (have().some((h) => h === want || h.split(/\s+/).includes(want))) continue;
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
  // Languages — one ROW per language: a Language
  // dropdown plus Overall/Reading/Speaking/Writing/Comprehension dropdowns
  // and an "I am fluent in this language" box. A row only makes sense in the
  // context of its own language, which is exactly what the generic pass
  // cannot see — so rows are answered here, and rows for a language that
  // isn't in the profile are left for a human.
  // -------------------------------------------------------------------------
  const PROFICIENCY_RE =
    /^(overall|comprehension|understanding|listening|reading|speaking|writing|verbal|translation)\b/;

  function proficiencyFor(fluency) {
    const n = D().norm(fluency);
    if (!n) return "";
    if (/native|bilingual/.test(n)) return "Native";
    if (/fluent/.test(n)) return "Fluent";
    return fluency;
  }

  async function fillLanguageSection(stats) {
    const d = D(), p = P();
    const langs = (p.languages || []).filter((l) => l.language && l.fluency);
    if (!langs.length) return;
    // Match on each control's LABEL, never on a container's textContent:
    // Workday concatenates label + value + "Required" with no separator, so
    // "Overall" arrives as "overallselect onerequired" (fixture-proven).
    const buttons = () => [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
      .filter((b) => d.isVisible(b));
    const isProf = (b) => PROFICIENCY_RE.test(d.norm(d.labelFor(b)));
    const isLangPicker = (b) => /^language\b/.test(d.norm(d.labelFor(b)));

    for (const lang of langs) {
      const want = d.norm(lang.language);
      // The row's Language dropdown already holds the language name.
      const anchor = buttons().find(
        (b) => d.norm(b.textContent) === want && isLangPicker(b));
      if (!anchor) continue;

      // Smallest ancestor that also holds this row's proficiency questions.
      let row = null;
      let n = anchor.closest('[data-automation-id*="formField"]') || anchor;
      for (let i = 0; i < 6 && n; i++) {
        if (buttons().some((b) => n.contains(b) && isProf(b))) { row = n; break; }
        n = n.parentElement;
      }
      if (!row) continue;
      // A "row" holding two language pickers is really the whole section —
      // filling it would answer another language with this one's level.
      if (buttons().filter((b) => row.contains(b) && isLangPicker(b)).length > 1) {
        d.log("languages: flat layout, left for a human");
        continue;
      }
      try { row.setAttribute("data-wdaf-block", `language-${want}`); } catch (e) { /* ok */ }

      const value = proficiencyFor(lang.fluency);
      if (!value) continue;
      for (const btn of buttons().filter((b) => row.contains(b) && isProf(b))) {
        try {
          const ok = await fillDropdown(
            { el: btn, label: d.labelFor(btn), automationId: "" }, value);
          if (ok) stats.filled++;
        } catch (e) { stats.skipped++; }
      }
      // "I am fluent in this language" — true only for native/fluent.
      const fluentBox = [...row.querySelectorAll('input[type="checkbox"]')]
        .find((c) => /fluent/.test(d.norm(d.labelFor(c) || d.clickTargetFor(c).textContent)));
      if (fluentBox && /native|fluent/i.test(value) && !fluentBox.checked) {
        try {
          d.simClick(d.clickTargetFor(fluentBox));
          d.flash(fluentBox);
          stats.filled++;
        } catch (e) { stats.skipped++; }
      }
    }
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
      await fillLanguageSection(stats);

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
          else if (f.kind === "checkbox")   ok = await fillCheckbox(f, value);
          else if (f.kind === "radiogroup") ok = fillRadioGroup(f, value);
          else if (f.kind === "date")       ok = await fillDate(f, value);
          else if (f.kind === "prompt")     ok = await fillPromptWidget(f.el, value);
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
