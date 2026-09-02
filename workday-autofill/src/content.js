// ============================================================================
// content.js — entry point. Wires the MutationObserver, keyboard shortcuts,
// the corner badge, and the resume-engine handoff.
//
// Shortcuts (Option = Alt on Windows):
//   Option+Shift+F  fill the current step now
//   Option+Shift+A  toggle auto-fill for this tab
//   Option+Shift+J  copy this job's description for /tailor (resume-engine)
//   Option+Shift+U  dump unmapped fields to the console as mapping lines
//   Option+Shift+X  clear the unmapped-field log
// ============================================================================
(() => {
  if (window.top !== window) return; // top frame only
  const d = WDAF.dom;

  // ---- Auto-fill toggle (per tab) ------------------------------------------
  const autoOn = () => sessionStorage.getItem("wdaf-auto") !== "0";
  const setAuto = (on) => sessionStorage.setItem("wdaf-auto", on ? "1" : "0");

  // ---- Corner badge --------------------------------------------------------
  let badge = null;
  let toastTimer = null;
  function ensureBadge() {
    if (badge && document.contains(badge)) return badge;
    d.injectStyles();
    badge = document.createElement("div");
    badge.id = "wdaf-badge";
    badge.title = "Workday Autofill — ⌥⇧F fill · ⌥⇧A auto on/off · ⌥⇧J copy JD for /tailor · ⌥⇧U dump unmapped";
    document.documentElement.appendChild(badge);
    return badge;
  }
  function renderBadge(stats) {
    const s = stats || WDAF.engine.lastStats();
    const auto = autoOn()
      ? "AUTO ON"
      : '<span class="wdaf-off">AUTO OFF</span>';
    ensureBadge().innerHTML =
      `⚡ <b>${s.filled}</b> filled · ${s.skipped} skipped · ${auto}`;
  }
  function toast(msg, ms = 3500) {
    ensureBadge().innerHTML = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => renderBadge(), ms);
  }

  // ---- Fill orchestration --------------------------------------------------
  let suppressUntil = 0;
  let lastSig = "";

  function stepSignature() {
    const ids = [...document.querySelectorAll(
      "[data-automation-id^=\"formField\"], button[aria-haspopup=\"listbox\"]")]
      .map((n) => n.getAttribute("data-automation-id") || "")
      .join(",");
    return `${location.href}|${ids}`;
  }

  async function runFill(reason) {
    if (WDAF.engine.isFilling()) return;
    d.log("fill:", reason);
    try {
      const stats = await WDAF.engine.fillStep();
      renderBadge(stats);
    } catch (e) {
      d.log("fillStep blew up (recovered):", e);
      renderBadge();
    } finally {
      suppressUntil = Date.now() + 1500; // our own DOM writes are not a new step
      lastSig = stepSignature();
    }
  }

  // ---- Step-change detection (SPA wizard swaps DOM without navigation) -----
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onSettled, 500);
  });

  function onSettled() {
    if (WDAF.engine.isFilling() || Date.now() < suppressUntil) return;
    highlightDropZone();
    const sig = stepSignature();
    if (sig === lastSig) return;
    lastSig = sig;
    if (!hasFormFields()) { renderBadge(); return; }
    if (autoOn()) runFill("step change");
    else renderBadge();
  }

  const hasFormFields = () => !!document.querySelector(
    'input[data-automation-id], textarea[data-automation-id], button[aria-haspopup="listbox"]');

  // ---- Resume-engine handoff -----------------------------------------------
  // ⌥⇧J copies the JD; paste it into `claude` inside ~/resume-engine (a bare
  // pasted JD auto-runs /tailor there). The PDF lands in ~/Desktop/Resumes —
  // drag it onto Workday's upload box, which we outline when it appears.
  async function copyJobDescription() {
    const jd = document.querySelector('[data-automation-id="jobPostingDescription"]');
    const header = document.querySelector('[data-automation-id="jobPostingHeader"], h1, h2');
    if (!jd) {
      toast("No job description on this page — open the job posting first");
      return;
    }
    const text = [
      "/tailor",
      "",
      `Role: ${header ? header.innerText.trim() : "(unknown)"}`,
      `Tenant: ${location.hostname}`,
      `URL: ${location.href}`,
      "",
      jd.innerText.trim(),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("📋 JD copied — paste into <b>claude</b> in ~/resume-engine, PDF → ~/Desktop/Resumes");
    } catch (e) {
      console.log("[WDAF] Clipboard blocked — JD below:\n\n" + text);
      toast("Clipboard blocked — JD printed to console instead");
    }
  }

  function highlightDropZone() {
    for (const zone of document.querySelectorAll(
      '[data-automation-id="file-upload-drop-zone"], [data-automation-id="attachments-FileUpload"]')) {
      if (zone.classList.contains("wdaf-dropzone")) continue;
      d.injectStyles();
      zone.classList.add("wdaf-dropzone");
      toast("📄 Drag your tailored PDF here — latest builds are in <b>~/Desktop/Resumes</b>", 6000);
    }
  }

  // ---- Keyboard shortcuts --------------------------------------------------
  window.addEventListener("keydown", (e) => {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    const act = {
      KeyF: () => runFill("manual"),
      KeyA: () => {
        setAuto(!autoOn());
        toast(autoOn() ? "Auto-fill <b>ON</b>" : 'Auto-fill <span class="wdaf-off">OFF</span> for this tab');
      },
      KeyJ: () => copyJobDescription(),
      KeyU: () => WDAF.engine.dumpUnmapped()
        .then((n) => toast(n ? `🧠 ${n} unmapped fields dumped to console (⌥⌘J)` : "No unmapped fields — full hit rate")),
      KeyX: () => WDAF.engine.clearUnmapped().then(() => toast("Unmapped log cleared")),
    }[e.code];
    if (act) { e.preventDefault(); e.stopPropagation(); act(); }
  }, true);

  // ---- Boot ----------------------------------------------------------------
  async function boot() {
    ensureBadge();
    renderBadge();
    observer.observe(document.body, { childList: true, subtree: true });
    // First render can lag document_idle on Workday's SPA — wait for fields.
    await d.waitFor(() => hasFormFields() || null, 8000);
    highlightDropZone();
    if (hasFormFields() && autoOn()) runFill("initial load");
  }

  boot().catch((e) => console.warn("[WDAF] boot failed", e));
})();
