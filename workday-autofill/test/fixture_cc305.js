// Stand-ins for the two widgets that broke on a live tenant 2026-09-10:
//
//  1. a prompt/multiselect ("How Did You Hear About Us?") whose answer only
//     commits when an OPTION IS CLICKED — typed text is discarded, and the
//     leaf sits under a category, exactly like Workday's hierarchical prompt.
//  2. a CC-305 date whose segment inputs are DECOYS (every write is reverted,
//     as Workday's are) and whose calendar opens on the WRONG month —
//     September 2009, the state a live failed typing attempt left behind.
(function () {
  const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  window.makePrompt = function (host, question, tree) {
    const ff = document.createElement("div");
    ff.setAttribute("data-automation-id", "formField-hdyh");
    const lb = document.createElement("label");
    lb.textContent = question;
    ff.appendChild(lb);
    const chips = document.createElement("div");
    chips.setAttribute("data-automation-id", "selectedItemList");
    ff.appendChild(chips);
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("data-automation-id", "searchBox");
    ff.appendChild(input);

    const close = () => {
      const l = document.getElementById("prompt-list");
      if (l) l.remove();
    };
    const open = (filter) => {
      close();
      const list = document.createElement("div");
      list.id = "prompt-list";
      list.setAttribute("role", "listbox");
      // No filter typed -> only the CATEGORIES show, the way Workday's
      // hierarchical prompt does. Typing searches every level.
      const rows = filter
        ? Object.entries(tree).flatMap(([cat, leaves]) => leaves)
            .filter((leaf) => leaf.toLowerCase().includes(filter.toLowerCase()))
        : Object.keys(tree);
      for (const label of rows) {
        const row = document.createElement("div");
        row.setAttribute("data-automation-id", "promptOption");
        row.setAttribute("role", "option");
        row.textContent = label;
        row.addEventListener("click", () => {
          if (tree[label]) { open(""); return; }   // a category: drill in
          const chip = document.createElement("span");
          chip.setAttribute("data-automation-id", "selectedItem");
          chip.textContent = label;
          chips.appendChild(chip);
          input.value = "";
          close();
        });
        list.appendChild(row);
      }
      document.body.appendChild(list);
    };
    input.addEventListener("click", () => open(input.value));
    input.addEventListener("input", () => open(input.value));
    host.appendChild(ff);
  };

  // A checkbox that IGNORES clicks and only toggles on Space — the CC-305
  // consent behaviour that made every synthetic click a no-op.
  window.makeSpaceOnlyCheckbox = function (host, label, id) {
    const ff = document.createElement("div");
    ff.setAttribute("data-automation-id", `formField-${id}`);
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.id = id;
    const lb = document.createElement("label");
    lb.setAttribute("for", id);
    lb.textContent = label;
    // swallow clicks (both on the label and on the input)
    const swallow = (e) => { e.preventDefault(); e.stopPropagation(); cb.checked = false; };
    lb.addEventListener("click", swallow, true);
    cb.addEventListener("click", swallow, true);
    cb.addEventListener("keydown", (e) => {
      if (e.key === " " || e.code === "Space") cb.checked = !cb.checked;
    });
    ff.appendChild(cb); ff.appendChild(lb);
    host.appendChild(ff);
  };

  window.makeCC305Date = function (host, openMonth, openYear) {
    const ff = document.createElement("div");
    ff.setAttribute("data-automation-id", "formField-date");
    const lb = document.createElement("label");
    lb.textContent = "Date*";
    ff.appendChild(lb);
    const wrap = document.createElement("div");
    wrap.setAttribute("data-automation-id", "dateInputWrapper");
    ff.appendChild(wrap);

    let committing = false;
    const seg = {};
    for (const name of ["Month", "Day", "Year"]) {
      const s = document.createElement("input");
      s.setAttribute("data-automation-id", `dateSection${name}-input`);
      // DECOY: any write that isn't from the calendar is thrown away.
      s.addEventListener("input", () => { if (!committing) s.value = ""; });
      wrap.appendChild(s);
      seg[name] = s;
    }

    const icon = document.createElement("button");
    icon.setAttribute("data-automation-id", "dateIcon");
    icon.textContent = "📅";
    wrap.appendChild(icon);

    let cur = { m: openMonth, y: openYear };   // where the popup opens
    const today = new Date();
    const close = () => {
      const p = document.querySelector('[data-automation-id="datePicker"]');
      if (p) p.remove();
    };
    const render = () => {
      close();
      const pop = document.createElement("div");
      pop.setAttribute("data-automation-id", "datePicker");
      const prev = document.createElement("button");
      prev.setAttribute("data-automation-id", "previousControl");
      prev.textContent = "‹";
      prev.addEventListener("click", () => {
        cur = cur.m === 1 ? { m: 12, y: cur.y - 1 } : { m: cur.m - 1, y: cur.y };
        render();
      });
      const next = document.createElement("button");
      next.setAttribute("data-automation-id", "nextControl");
      next.textContent = "›";
      next.addEventListener("click", () => {
        cur = cur.m === 12 ? { m: 1, y: cur.y + 1 } : { m: cur.m + 1, y: cur.y };
        render();
      });
      const head = document.createElement("div");
      head.setAttribute("data-automation-id", "datePickerMonth");
      head.textContent = `${MONTHS[cur.m - 1]} ${cur.y}`;
      pop.appendChild(prev); pop.appendChild(head); pop.appendChild(next);

      const days = new Date(cur.y, cur.m, 0).getDate();
      for (let n = 1; n <= days; n++) {
        const cell = document.createElement("div");
        const isToday = n === today.getDate() && cur.m === today.getMonth() + 1
          && cur.y === today.getFullYear();
        cell.setAttribute("data-automation-id",
          isToday ? "datePickerSelectedToday" : "datePickerDay");
        cell.setAttribute("aria-label", `${MONTHS[cur.m - 1]} ${n}, ${cur.y}`);
        cell.textContent = String(n);
        cell.addEventListener("click", () => {
          committing = true;
          seg.Month.value = String(cur.m);
          seg.Day.value = String(n);
          seg.Year.value = String(cur.y);
          committing = false;
          close();
        });
        pop.appendChild(cell);
      }
      document.body.appendChild(pop);
    };
    icon.addEventListener("click", () => render());
    host.appendChild(ff);
  };
})();
