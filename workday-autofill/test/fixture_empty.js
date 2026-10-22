// "My Experience" as it renders on a FRESH application: Work Experience,
// Education and Skills sections that contain nothing but a heading and an
// "Add" button. the user had to click all three by hand (live 2026-09-10).
// Clicking Add injects the same block markup Workday would.
(function () {
  let expN = 0, eduN = 0;

  const field = (label, tag) => {
    const ff = document.createElement("div");
    ff.setAttribute("data-automation-id", `formField-${label.replace(/\W+/g, "")}${Math.random().toString(36).slice(2, 6)}`);
    const lb = document.createElement("label");
    lb.textContent = label;
    ff.appendChild(lb);
    ff.appendChild(document.createElement(tag || "input"));
    return ff;
  };

  const dateWrapper = (label) => {
    const ff = field(label, "span");
    const w = document.createElement("div");
    w.setAttribute("data-automation-id", "dateInputWrapper");
    for (const seg of ["Month", "Year"]) {
      const i = document.createElement("input");
      i.setAttribute("data-automation-id", `dateSection${seg}-input`);
      w.appendChild(i);
    }
    ff.appendChild(w);
    return ff;
  };

  window.makeEmptySection = function (host, heading, kind) {
    const h = document.createElement("h2");
    h.textContent = heading;
    host.appendChild(h);
    const add = document.createElement("button");
    add.textContent = "Add";
    host.appendChild(add);
    const holder = document.createElement("div");
    host.appendChild(holder);

    add.addEventListener("click", () => {
      const block = document.createElement("div");
      // no workExperience-N / education-N ids — label mode, like the tenant
      block.className = "entry";
      if (kind === "work") {
        expN++;
        block.appendChild(field("Job Title*"));
        block.appendChild(field("Company*"));
        block.appendChild(field("Location"));
        block.appendChild(dateWrapper("From*"));
        block.appendChild(dateWrapper("To"));
        block.appendChild(field("Role Description", "textarea"));
      } else {
        eduN++;
        block.appendChild(field("School or University*"));
        block.appendChild(field("Degree"));
        block.appendChild(field("Field of Study"));
      }
      holder.appendChild(block);
    });
  };

  window.makeSkillsPrompt = function (host) {
    const h = document.createElement("h2");
    h.textContent = "Skills";
    host.appendChild(h);
    const ff = document.createElement("div");
    ff.setAttribute("data-automation-id", "formField-skills");
    const lb = document.createElement("label");
    lb.textContent = "Type to Add Skills";   // the label one live tenant shows
    ff.appendChild(lb);
    const chips = document.createElement("div");
    chips.setAttribute("data-automation-id", "selectedItemList");
    ff.appendChild(chips);
    const input = document.createElement("input");
    input.setAttribute("data-automation-id", "searchBox");
    ff.appendChild(input);
    const close = () => {
      const l = document.getElementById("skill-list");
      if (l) l.remove();
    };
    const open = () => {
      close();
      const list = document.createElement("div");
      list.id = "skill-list";
      list.setAttribute("role", "listbox");
      const term = input.value.trim();
      if (term) {
        const row = document.createElement("div");
        row.setAttribute("data-automation-id", "promptOption");
        row.textContent = term;
        row.addEventListener("click", () => {
          const chip = document.createElement("span");
          chip.setAttribute("data-automation-id", "selectedItem");
          chip.textContent = term;
          chips.appendChild(chip);
          input.value = "";
          close();
        });
        list.appendChild(row);
      }
      document.body.appendChild(list);
    };
    input.addEventListener("input", open);
    input.addEventListener("click", open);
    host.appendChild(ff);
  };
})();
