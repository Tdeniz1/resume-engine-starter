// The Education block as one live tenant renders it (live 2026-09-10):
//  - Degree is a listbox button whose form field ALSO holds a hidden input
//    (the thing that used to get handed to fillDropdown instead of the button)
//  - the option list is degree-based on one tenant and MAJOR-based on another
//  - Field of Study is a search prompt whose rows are radio buttons
(function () {
  const DEGREES = ["MBA", "Masters", "Juris Doctor", "High School", "Doctorate", "Bachelors"];
  const MAJORS = ["Bioinformatics", "Biology", "Biomedical Applications", "Biomedical Engineering"];

  const wrap = (host, label, id) => {
    const ff = document.createElement("div");
    ff.setAttribute("data-automation-id", `formField-${id}`);
    const lb = document.createElement("label");
    lb.textContent = label;
    ff.appendChild(lb);
    host.appendChild(ff);
    return ff;
  };

  window.makeEducationBlock = function (host, degreeOptions) {
    const block = document.createElement("div");
    block.className = "edu-entry";
    host.appendChild(block);

    const school = wrap(block, "School or University*", "school");
    school.appendChild(document.createElement("input"));

    // Degree: hidden input FIRST, then the real listbox button.
    const deg = wrap(block, "Degree*", "degree");
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    deg.appendChild(hidden);
    const btn = document.createElement("button");
    btn.setAttribute("aria-haspopup", "listbox");
    btn.textContent = "Select One";
    btn.addEventListener("click", () => {
      if (document.getElementById("deg-list")) return;
      const list = document.createElement("div");
      list.id = "deg-list";
      list.setAttribute("role", "listbox");
      for (const o of degreeOptions) {
        const row = document.createElement("div");
        row.setAttribute("role", "option");
        row.textContent = o;
        row.addEventListener("click", () => { btn.textContent = o; list.remove(); });
        list.appendChild(row);
      }
      document.body.appendChild(list);
    });
    deg.appendChild(btn);

    // Field of Study: search prompt, radio rows, no chip — the selection
    // shows as the input's own value.
    const fos = wrap(block, "Field of Study", "fos");
    const input = document.createElement("input");
    input.setAttribute("data-automation-id", "searchBox");
    input.placeholder = "Search";
    fos.appendChild(input);
    const open = () => {
      const old = document.getElementById("fos-list");
      if (old) old.remove();
      const list = document.createElement("div");
      list.id = "fos-list";
      const term = input.value.trim().toLowerCase();
      for (const m of MAJORS.filter((x) => !term || x.toLowerCase().includes(term))) {
        const row = document.createElement("div");
        row.setAttribute("role", "radio");
        row.textContent = m;
        row.addEventListener("click", () => {
          input.value = m;
          const chip = document.createElement("span");
          chip.setAttribute("data-automation-id", "selectedItem");
          chip.textContent = m;
          fos.appendChild(chip);
          list.remove();
        });
        list.appendChild(row);
      }
      document.body.appendChild(list);
    };
    input.addEventListener("click", open);
    input.addEventListener("input", open);

    const gpa = wrap(block, "Overall Result (GPA)", "gpa");
    gpa.appendChild(document.createElement("input"));
    return block;
  };
})();
