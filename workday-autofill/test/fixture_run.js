// Builds the question widgets, then exposes runFill() for the test driver.
(function () {
  const qbox = document.getElementById("questions");
  const YN = ["Yes", "No"];
  makeDropdown(qbox, {
    question: "Please select your current college or university class standing",
    value: "4th year (Senior)", selfLabel: true,
    options: ["1st year (Freshman)", "4th year (Senior)"],
  });
  makeDropdown(qbox, {
    question: "Do you have legal authorization to work in the U.S. on a permanent basis?",
    options: YN,
  });
  makeDropdown(qbox, {
    question: "Within the last three (3) years have you been subject to any disciplinary action by a licensing board?",
    options: YN,
  });
  makeDropdown(qbox, {
    question: "If required by the position you are applying for, are you willing and able to travel?",
    options: YN,
  });
  makeDropdown(qbox, {
    question: "What percentage of time are you willing to travel?*",
    options: ["0-25%", "26-50%", "51-75%", "76-100%"],
  });
  makeDropdown(qbox, {
    question: "What are your annual salary requirements (annual rate = hourly rate x 2080)?",
    options: ["Under $60,000", "$60,000 - $90,000", "Over $90,000"],
  });
  makeLanguageRow(document.getElementById("row-en"), "English");

  // --- the five live failures from 2026-09-10 -------------------------------
  makeDropdown(qbox, {
    question: "Will you require employer support to obtain or maintain authorization to work in that country?",
    options: YN,
  });
  makeDropdown(qbox, {
    question: "Do you identify as one of the following protected veterans?",
    options: ["I identify as one or more of the classifications of a protected veteran",
              "I am not a veteran", "I don't wish to answer"],
  });
  makeSpaceOnlyCheckbox(document.getElementById("consent"),
    "By selecting the checkbox, you agree to our Terms and Conditions and Applicant Privacy Policy.*",
    "terms");
  makePrompt(document.getElementById("hdyh"), "How Did You Hear About Us?", {
    "Job Boards": ["Indeed", "LinkedIn"],
    "Referral": ["Employee Referral"],
    "Other Sources": ["Company Website", "Career Fair"],
  });
  // opens on September 2009 — the wrong-year state a failed typing attempt left
  makeCC305Date(document.getElementById("selfid"), 9, 2009);

  window.snapshot = function () {
    const txt = (sel) => {
      const el = document.querySelector(sel);
      return el ? (el.value !== undefined ? el.value : el.textContent) : null;
    };
    const entry = document.querySelector("#expSection .entry");
    const inputs = [...entry.querySelectorAll("input, textarea")];
    const dd = {};
    for (const b of document.querySelectorAll('button[aria-haspopup="listbox"]')) {
      const ff = b.closest('[data-automation-id^="formField"]');
      const q = ff ? ff.firstChild.textContent.slice(0, 46) : "(no formField)";
      dd[q] = b.textContent;
    }
    return {
      experience: {
        title: inputs[0].value, company: inputs[1].value, location: inputs[2].value,
        currentlyWorkHere: entry.querySelector("#cur1").checked,
        fromMonth: entry.querySelectorAll('[data-automation-id="dateSectionMonth-input"]')[0].value,
        fromYear: entry.querySelectorAll('[data-automation-id="dateSectionYear-input"]')[0].value,
        description: entry.querySelector("textarea").value.slice(0, 40),
      },
      skillBoxes: {
        javaSql: document.getElementById("s1").checked,
        tableau: document.getElementById("s2").checked,
        other: document.getElementById("s3").checked,
      },
      fluentBox: document.getElementById("fluent-English").checked,
      employeeId: txt('[data-automation-id="formField-emp"] input'),
      reasonForLeaving: txt('[data-automation-id="formField-leave"] textarea').slice(0, 40),
      smsOptIn: document.getElementById("sms").checked,
      selfIdName: txt('[data-automation-id="formField-name"] input'),
      // scope to the CC-305 wrapper — the experience block has date inputs
      // with the same automation-ids earlier in the document
      selfIdDate: ["Month", "Day", "Year"].map((n) =>
        document.querySelector('[data-automation-id="formField-date"]')
          .querySelector(`[data-automation-id="dateSection${n}-input"]`).value).join("/"),
      termsChecked: document.getElementById("terms").checked,
      hdyhChip: (document.querySelector('[data-automation-id="selectedItem"]') || {}).textContent || null,
      dropdowns: dd,
      blockTags: [...document.querySelectorAll("[data-wdaf-block]")]
        .map((b) => b.getAttribute("data-wdaf-block")),
    };
  };

  window.runFill = async function () {
    const stats = await WDAF.engine.fillStep();
    return {
      filled: stats.filled, skipped: stats.skipped,
      unmapped: stats.unmapped.map((u) => `${u.kind}: ${u.automationId || u.label}`),
      snapshot: snapshot(),
    };
  };
})();
