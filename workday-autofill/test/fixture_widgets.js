// Minimal stand-ins for the two Workday widgets the engine drives:
// a listbox-button dropdown that renders promptOption rows on click, and a
// language row. Behaviour copied from what the engine expects, not from
// Workday's implementation.
(function () {
  let uid = 0;

  window.makeDropdown = function (host, opts) {
    // opts: { question, value, options, selfLabel }
    const id = `dd${++uid}`;
    const ff = document.createElement("div");
    ff.setAttribute("data-automation-id", `formField-${id}`);
    const qs = document.createElement("span");
    qs.textContent = opts.question;
    ff.appendChild(qs);

    const btn = document.createElement("button");
    btn.setAttribute("aria-haspopup", "listbox");
    btn.textContent = opts.value || "Select One";
    if (opts.selfLabel) {
      // Workday points aria-labelledby at a node holding the button's OWN
      // value — the junk label the engine has to see through.
      const junk = document.createElement("span");
      junk.id = `${id}-junk`;
      junk.textContent = `${btn.textContent} Required`;
      junk.style.display = "none";
      ff.appendChild(junk);
      btn.setAttribute("aria-labelledby", junk.id);
    }
    btn.addEventListener("click", () => {
      if (document.querySelector(`#${id}-list`)) return;
      const list = document.createElement("div");
      list.id = `${id}-list`;
      list.setAttribute("role", "listbox");
      for (const o of opts.options) {
        const row = document.createElement("div");
        row.setAttribute("data-automation-id", "promptOption");
        row.setAttribute("role", "option");
        row.textContent = o;
        row.addEventListener("click", () => {
          btn.textContent = o;
          list.remove();
        });
        list.appendChild(row);
      }
      document.body.appendChild(list);
    });
    ff.appendChild(btn);
    host.appendChild(ff);
    return btn;
  };

  window.makeLanguageRow = function (host, language) {
    const q = (label, value, options) =>
      makeDropdown(host, { question: label, value, options, selfLabel: true });
    // The row's language dropdown is already answered, self-labelled.
    q("Language", language, [language]);
    const scale = ["Novice", "Intermediate", "Advanced", "Fluent"];
    for (const p of ["Overall", "Comprehension", "Reading", "Speaking", "Writing"]) {
      q(p, "", scale);
    }
    const ff = document.createElement("div");
    ff.setAttribute("data-automation-id", "formField-fluent");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.id = `fluent-${language}`;
    const lb = document.createElement("label");
    lb.setAttribute("for", cb.id);
    lb.textContent = "I am fluent in this language.";
    ff.appendChild(cb); ff.appendChild(lb);
    host.appendChild(ff);
  };
})();
