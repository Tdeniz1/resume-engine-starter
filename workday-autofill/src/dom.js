// ============================================================================
// dom.js — low-level DOM helpers. No Workday knowledge lives here.
// ============================================================================
window.WDAF = window.WDAF || {};

WDAF.dom = (() => {
  const LOG = "[WDAF]";

  // Lowercase, strip trailing asterisk, strip punctuation, collapse whitespace.
  function norm(s) {
    return (s || "")
      .replace(/\*\s*$/, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // React-safe value set: real focus, native setter, bubbling events, real
  // blur — some Workday number/text fields only commit on a true focus cycle.
  function setNativeValue(el, value) {
    try { el.focus(); } catch (e) { /* non-focusable */ }
    const proto = el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    try { el.blur(); } catch (e) { /* ok */ }
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  // Full synthetic click sequence — React listens on pointer/mouse events.
  function simClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
    } catch (e) { /* PointerEvent quirks — the plain click below still fires */ }
    el.click();
  }

  // Poll on animation frames for a selector (string) or predicate (function
  // returning a truthy value). Resolves null on timeout — never hangs.
  function waitFor(selectorOrFn, timeoutMs = 2000, root = document) {
    return new Promise((resolve) => {
      const started = performance.now();
      (function poll() {
        let hit = null;
        try {
          hit = typeof selectorOrFn === "function"
            ? selectorOrFn()
            : root.querySelector(selectorOrFn);
        } catch (e) { /* bad selector → treat as miss */ }
        if (hit) return resolve(hit);
        if (performance.now() - started > timeoutMs) return resolve(null);
        requestAnimationFrame(poll);
      })();
    });
  }

  const settle = () => new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)));

  // Best-effort visible label for a field element.
  // Workday dropdowns aria-label themselves with their own VALUE
  // ("Select One Required") — that junk must never win over the real
  // question text in the surrounding form-field container.
  function labelFor(el) {
    if (!el || !el.getAttribute) return "";
    const doc = el.ownerDocument;
    const junk = (s) => {
      const n = norm(s || "");
      // a control's own value ("Yes"/"No"/"Select One", ± "Required") is
      // never the question label
      return !n || /^(select one|yes|no)( required)?$/.test(n)
        || n === "required";
    };
    const textOf = (id) => {
      const n = doc.getElementById(id);
      return n ? n.textContent : "";
    };
    const byIds = el.getAttribute("aria-labelledby");
    if (byIds) {
      const t = byIds.split(/\s+/).map(textOf).join(" ").trim();
      if (t && !junk(t)) return t;
    }
    const aria = el.getAttribute("aria-label");
    if (aria && !junk(aria)) return aria;
    if (el.id) {
      const l = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && l.textContent.trim() && !junk(l.textContent)) return l.textContent;
    }
    const ff = el.closest('[data-automation-id^="formField"]');
    if (ff) {
      const l = ff.querySelector("label, legend");
      if (l && l.textContent.trim() && !junk(l.textContent)) return l.textContent;
      // Question text lives as loose text in the container — take the
      // container text minus the control's own value.
      const own = (el.textContent || "").trim();
      let t = (ff.textContent || "");
      if (own) t = t.split(own).join(" ");
      t = t.replace(/\brequired\b/gi, " ").trim();
      if (t.length > 6) return t.slice(0, 200);
    }
    const fs = el.closest("fieldset");
    if (fs) {
      const lg = fs.querySelector("legend");
      if (lg && lg.textContent.trim()) return lg.textContent;
    }
    return "";
  }

  // The visible label element to click for a hidden checkbox/radio input.
  function clickTargetFor(input) {
    if (input.id) {
      const l = input.ownerDocument.querySelector(
        `label[for="${CSS.escape(input.id)}"]`);
      if (l) return l;
    }
    const wrap = input.closest('[data-automation-id="radioBtn"], [data-automation-id="checkboxPanel"]')
      || input.parentElement;
    if (wrap) {
      const l = wrap.querySelector("label");
      if (l) return l;
    }
    return input; // last resort
  }

  // ---- Green verify-flash --------------------------------------------------
  let styleInjected = false;
  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    const st = document.createElement("style");
    st.id = "wdaf-styles";
    st.textContent = `
      @keyframes wdaf-flash {
        0%, 55%  { box-shadow: 0 0 0 2px #16a34a, 0 0 8px 2px rgba(22,163,74,.35); }
        100%     { box-shadow: 0 0 0 2px rgba(22,163,74,0); }
      }
      .wdaf-flash { animation: wdaf-flash 1.5s ease forwards; border-radius: 3px; }
      .wdaf-dropzone { outline: 2px dashed #16a34a !important; outline-offset: 4px; }
      #wdaf-badge {
        position: fixed; right: 14px; bottom: 14px; z-index: 2147483647;
        background: rgba(17, 24, 39, .92); color: #e5e7eb;
        font: 12px/1.5 -apple-system, "Segoe UI", sans-serif;
        padding: 6px 12px; border-radius: 999px; pointer-events: auto; cursor: default;
        box-shadow: 0 2px 10px rgba(0,0,0,.35); white-space: nowrap;
      }
      #wdaf-badge b { color: #4ade80; font-weight: 600; }
      #wdaf-badge .wdaf-off { color: #f87171; }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  function flash(el) {
    try {
      injectStyles();
      const target = el.closest('[data-automation-id^="formField"]') || el;
      target.classList.remove("wdaf-flash");
      void target.offsetWidth; // restart animation on refill
      target.classList.add("wdaf-flash");
      target.addEventListener("animationend",
        () => target.classList.remove("wdaf-flash"), { once: true });
    } catch (e) { /* cosmetic only */ }
  }

  const log = (...args) => console.debug(LOG, ...args);

  return { norm, setNativeValue, isVisible, simClick, waitFor, settle,
           labelFor, clickTargetFor, flash, injectStyles, log };
})();
