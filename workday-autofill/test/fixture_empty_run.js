(function () {
  makeEmptySection(document.getElementById("work"), "Work Experience", "work");
  makeEmptySection(document.getElementById("edu"), "Education", "edu");
  makeSkillsPrompt(document.getElementById("skills"));

  window.runFill = async function () {
    const stats = await WDAF.engine.fillStep();
    const blocks = [...document.querySelectorAll(".entry")];
    return {
      filled: stats.filled, skipped: stats.skipped,
      unmapped: stats.unmapped.map((u) => `${u.kind}: ${u.automationId || u.label}`),
      workBlocks: document.getElementById("work").querySelectorAll(".entry").length,
      eduBlocks: document.getElementById("edu").querySelectorAll(".entry").length,
      firstJob: blocks[0] ? [...blocks[0].querySelectorAll("input, textarea")].map((i) => i.value).filter(Boolean).slice(0, 4) : [],
      skills: [...document.querySelectorAll('#skills [data-automation-id="selectedItem"]')].map((c) => c.textContent),
    };
  };
})();
