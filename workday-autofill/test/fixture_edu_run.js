(function () {
  const DEGREES = ["MBA", "Masters", "Juris Doctor", "High School", "Doctorate", "Bachelors"];
  const MAJORS = ["Bioinformatics", "Biology", "Biomedical Applications", "Biomedical Engineering"];
  makeEducationBlock(document.getElementById("eduDegreeBased"), DEGREES);

  const read = (host) => {
    const b = host.querySelector(".edu-entry");
    return {
      school: b.querySelector('[data-automation-id="formField-school"] input').value,
      degree: b.querySelector('[data-automation-id="formField-degree"] button').textContent,
      fieldOfStudy: b.querySelector('[data-automation-id="formField-fos"] input').value,
      gpa: b.querySelector('[data-automation-id="formField-gpa"] input').value,
    };
  };

  window.runFill = async function () {
    const stats = await WDAF.engine.fillStep();
    return {
      filled: stats.filled,
      unmapped: stats.unmapped.map((u) => `${u.kind}: ${u.automationId || u.label}`),
      degreeBased: read(document.getElementById("eduDegreeBased")),
    };
  };

  // Second scenario: the SAME "Degree" dropdown, but the tenant filled it
  // with majors instead of degrees.
  window.runMajorBased = async function () {
    document.getElementById("eduDegreeBased").innerHTML = "";
    makeEducationBlock(document.getElementById("eduMajorBased"), MAJORS);
    const stats = await WDAF.engine.fillStep();
    return { filled: stats.filled, majorBased: read(document.getElementById("eduMajorBased")) };
  };
})();
