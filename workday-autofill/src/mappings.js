// ============================================================================
// mappings.js — the ONLY Workday-specific knowledge: which field gets which
// profile value.
//
// A resolver is  p => value  where p is WDAF_PROFILE.
//   - return "" / null  → field is skipped silently
//   - return "Yes"/"No" → for radios and checkboxes
//   - return true/false → for checkboxes (true = check it)
//
// Adding a mapping when learning mode surfaces an unknown field is ONE line:
//   'someNew-automation-id': p => p.personal.email,
// or, when only a label was captured, one line in byLabel (normalized text —
// lowercase, no punctuation):
//   'some question text': p => p.workAuth.legallyAuthorized,
//
// ---------------------------------------------------------------------------
// ⚠️  WORK IN PROGRESS. This table is a SNAPSHOT of Workday's DOM and question
//     wording, and it goes stale. Every employer customizes their tenant, so
//     unmapped fields are the expected steady state and extending this file is
//     routine upkeep, not a bug.
//
// ⚠️  NEVER put a literal answer in here. Not "Yes", not "No", not a degree
//     level, not a class standing. Every resolver reads from profile.js and
//     returns "" when the field is unset, so the engine skips the question and
//     leaves it for the human. A hardcoded answer fills a LEGAL ATTESTATION
//     the same way for everyone who installs this. If a question has nowhere
//     to live in the profile, add a field to the `screening` block instead.
// ============================================================================
window.WDAF = window.WDAF || {};

WDAF.mappings = (() => {
  const is = (val, want) => {
    const v = WDAF.dom.norm(val);
    return v !== "" && v.includes(WDAF.dom.norm(want));
  };
  const lbl = (f) => WDAF.dom.norm((f && f.label) || "");

  // One resolver for every work-authorization phrasing. The matcher picks
  // the LONGEST key, so "authorization to work" (21 chars) used to outrank
  // "require sponsorship" (19) on "Will you require sponsorship to obtain
  // authorization to work…?" and answer the SPONSORSHIP question "Yes".
  const workAuth = (p, f) => {
    const l = lbl(f);
    if (/\bwithout (the need for )?(any )?(visa |employer )?sponsorship\b/.test(l))
      return p.workAuth.legallyAuthorized;
    if (/\bsponsor|employer support|immigration support/.test(l))
      return p.workAuth.requireSponsorship;
    return p.workAuth.legallyAuthorized;
  };
  // "Are you UNDER 18?" must never get the over-18 answer.
  // ("Are you 18 or older? If you are under 18, …" is still the over-18
  // question — only a label that never asks "or older / at least" is inverted)
  const over18 = (p, f) => {
    const l = lbl(f);
    return /\bunder\b/.test(l) && !/or older|at least|\bover\b/.test(l)
      ? "" : (p.workAuth.over18 || "");
  };
  // Screening answers. Every one of these is a claim about YOU on a real job
  // application, so there are no defaults anywhere in this file: an unset
  // field returns "" and the engine leaves the question untouched for you to
  // answer by hand. Never replace one of these with a literal "Yes"/"No":
  // that answers on behalf of whoever installs this next.
  const scr = (p, key) => (p.screening && p.screening[key]) || "";

  // "Are you a US citizen?" answers from screening.usCitizen when set,
  // otherwise derives from workAuth.citizenship, otherwise stays blank.
  const citizenYesNo = (p) => {
    const explicit = scr(p, "usCitizen");
    if (explicit) return explicit;
    const c = (p.workAuth && p.workAuth.citizenship) || "";
    if (!c) return "";
    return is(c, "united states") ? "Yes" : "No";
  };
  const usCitizen = (p, f) =>
    /\bif you are not\b|permanent resid/.test(lbl(f)) ? "" : citizenYesNo(p);
  const ds = (p) => WDAF.dom.norm(p.eeo.disabilityStatus);

  // Today, in MM/DD/YYYY, on THIS machine's clock — the date on the wall
  // where you are filling the form, and the date the tenant's calendar
  // marks as today in every case observed so far. (An earlier UTC version
  // read a day ahead after ~8pm EDT, which is how a whole night of "Enter
  // today's date" errors happened.) When the widget offers a calendar, the
  // engine clicks the popup's own today cell, so a tenant on a different
  // clock still gets ITS today, not ours.
  const today = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
  };

  const fullName = (p) =>
    [p.personal.firstName, p.personal.lastName].filter(Boolean).join(" ");

  // Technology-list checkbox labels ("Java, SQL, C#, C/C++, Python, etc.")
  // split into their individual technologies. Returns [] for anything that
  // isn't a short comma/slash list, so ordinary questions never land here.
  const skillTokens = (label) => {
    const parts = String(label || "")
      .split(/[,/]/)
      .map((s) => s.replace(/\betc\b\.?/i, "").trim())
      .filter(Boolean);
    if (parts.length < 2) return [];
    if (!parts.every((t) => t.length <= 24 && t.split(/\s+/).length <= 3)) return [];
    return parts;
  };

  // Check a technology-list box ONLY when one of the listed technologies is
  // actually in profile.skills. "" (not false) = leave it exactly as it is,
  // so a box you ticked yourself is never unticked.
  const hasAnySkill = (p, tokens) => {
    const mine = new Set((p.skills || []).map((s) => WDAF.dom.norm(s)));
    return tokens.some((t) => mine.has(WDAF.dom.norm(t))) ? true : "";
  };

  // "Worked here before?" depends on WHICH company's Workday we're on.
  const prevEmployed = (p) => {
    const list = (p.workAuth.previouslyEmployedAt || []).map((s) => s.toLowerCase());
    const host = location.hostname.toLowerCase();
    return list.some((t) => host.startsWith(t + "."))
      ? "Yes" : (p.workAuth.previouslyEmployed || "");
  };

  // ---- 1. Exact data-automation-id matches (primary strategy) --------------
  const byAutomationId = {
    // My Information step
    "legalNameSection_firstName":     p => p.personal.firstName,
    "legalNameSection_middleName":    p => p.personal.middleName,
    "legalNameSection_lastName":      p => p.personal.lastName,
    "preferredNameSection_firstName": p => p.personal.preferredName,
    "preferredNameSection_lastName":  p => p.personal.preferredName ? p.personal.lastName : "",
    "addressSection_addressLine1":    p => p.address.line1,
    "addressSection_addressLine2":    p => p.address.line2,
    "addressSection_city":            p => p.address.city,
    "addressSection_postalCode":      p => p.address.postalCode,
    "addressSection_countryRegion":   p => p.address.state,          // state dropdown
    "countryDropdown":                p => p.address.country,
    "country":                        p => p.address.country,
    "email":                          p => p.personal.email,
    "phone-device-type":              p => p.personal.phoneType,
    "phone-number":                   p => p.personal.phone,
    "country-phone-code":             p => p.personal.phoneCountryCode,
    "source":                         p => p.application.howDidYouHear,
    "candidateIsPreviousWorker":      p => prevEmployed(p),

    // Websites / social
    "linkedinQuestion":               p => p.links.linkedin,
    "linkedin":                       p => p.links.linkedin,
    "website":                        p => p.links.portfolio,

    // Voluntary disclosures / self-identification
    "gender":                         p => p.eeo.gender,
    "ethnicityDropdown":              p => p.eeo.raceEthnicity,
    "ethnicity":                      p => p.eeo.raceEthnicity,
    "hispanicOrLatino":               p => p.eeo.hispanicLatino,
    "veteranStatus":                  p => p.eeo.veteranStatus,
    "disability":                     p => p.eeo.disabilityStatus,
    "acceptTermsAndAgreements":       p => p.application.agreeToTerms,
    "createAccountCheckbox":          p => p.application.agreeToTerms,

    // Disability form (CC-305) asks for name + today's date
    "name":                           p => fullName(p),
    "signatureName":                  p => fullName(p),
    "todaysDate":                     () => today(),
  };

  // ---- 2. Normalized visible-label aliases (secondary strategy) ------------
  // Keys must already be normalized: lowercase, punctuation stripped.
  const byLabel = {
    // Identity
    "first name":                     p => p.personal.firstName,
    "given name":                     p => p.personal.firstName,
    "legal first name":               p => p.personal.firstName,
    "last name":                      p => p.personal.lastName,
    "family name":                    p => p.personal.lastName,
    "surname":                        p => p.personal.lastName,
    "legal last name":                p => p.personal.lastName,
    "middle name":                    p => p.personal.middleName,
    "full name":                      p => fullName(p),
    "name":                           p => fullName(p),  // CC-305 signature field

    // Contact
    "email":                          p => p.personal.email,
    "email address":                  p => p.personal.email,
    "phone number":                   p => p.personal.phone,
    "mobile number":                  p => p.personal.phone,
    "phone device type":              p => p.personal.phoneType,
    "device type":                    p => p.personal.phoneType,
    "phone type":                     p => p.personal.phoneType,
    "country phone code":             p => p.personal.phoneCountryCode,

    // Address
    "address line 1":                 p => p.address.line1,
    "street address":                 p => p.address.line1,
    "address line 2":                 p => p.address.line2,
    "city":                           p => p.address.city,
    "town":                           p => p.address.city,
    "state":                          p => p.address.state,
    "province":                       p => p.address.state,
    "state province":                 p => p.address.state,
    "postal code":                    p => p.address.postalCode,
    "zip":                            p => p.address.postalCode,
    "zip code":                       p => p.address.postalCode,
    "country":                        p => p.address.country,

    // Links
    "linkedin":                       p => p.links.linkedin,
    "linkedin url":                   p => p.links.linkedin,
    "linkedin profile":               p => p.links.linkedin,
    "github":                         p => p.links.github,
    "github url":                     p => p.links.github,
    "portfolio":                      p => p.links.portfolio,
    "personal website":               p => p.links.portfolio,

    // Screening questions (contains-match catches the long phrasings)
    "legally authorized to work":     workAuth,
    "authorized to work in the united states": workAuth,
    // One tenant's phrasing: "Do you have legal authorization to work in the U.S. on
    // a permanent basis…" — noun form, so the adjective keys above miss it.
    "legal authorization to work":    workAuth,
    "authorization to work":          workAuth,
    "require sponsorship":            p => p.workAuth.requireSponsorship,
    "visa sponsorship":               p => p.workAuth.requireSponsorship,
    "now or in the future require":   p => p.workAuth.requireSponsorship,
    // Same question, "employer support" phrasing (you, live 2026-09-10):
    // "Will you require employer support to obtain or maintain authorization
    // to work in that country?" → always No.
    "require employer support":       p => p.workAuth.requireSponsorship,
    "employer support to obtain":     p => p.workAuth.requireSponsorship,
    "obtain or maintain authorization": p => p.workAuth.requireSponsorship,
    "immigration support":            p => p.workAuth.requireSponsorship,
    "at least 18":                    over18,
    "18 years of age":                over18,
    "18 years or older":              over18,
    "currently hold a visa":          p => is(p.workAuth.citizenship, "united states") ? "No" : "",
    "previously been employed":       p => prevEmployed(p),
    "ever worked for":                p => prevEmployed(p),
    "employed by or worked":          p => prevEmployed(p),
    "contracted through an agency":   p => prevEmployed(p),
    "ever been employed by":          p => prevEmployed(p),
    "worked here before":             p => prevEmployed(p),
    "have you worked for":            p => prevEmployed(p),
    "country of citizenship":         p => p.workAuth.citizenship,
    "u s citizen":                    usCitizen,
    "us citizen or permanent resident": usCitizen,
    "any relatives":                  p => p.workAuth.relativesAtCompany,
    "have any family members":        p => p.workAuth.relativesAtCompany,
    "family members employed":        p => p.workAuth.relativesAtCompany,
    "immediate family member":        p => p.workAuth.relativesAtCompany,
    "immediate family members":       p => p.workAuth.relativesAtCompany,
    "family members practicing":      p => p.workAuth.relativesAtCompany,
    "are you bound by any":           p => scr(p, "boundByAgreement"),
    "aware of any ongoing negotiations": p => scr(p, "ongoingNegotiations"),
    // "completed AND AWARDED": a degree still in progress doesn't count
    "highest education degree level completed": p => scr(p, "highestDegreeCompleted"),
    "over the age of 18":             over18,
    // sponsorship variants only — "…in the future be able to work on-site
    // 5 days a week?" is a different question and is left for a human
    "will you now or in the future":  (p, f) =>
      /sponsor|visa|authoriz|immigration/.test(lbl(f)) ? p.workAuth.requireSponsorship : "",
    // Anti-corruption / conflict-of-interest screeners. All of these come
    // from the screening block, and all default to blank.
    "employed by a government agency": p => scr(p, "governmentAgencyEmployment"),
    "do you have a close family member": p => scr(p, "governmentOfficialFamily"),
    "subject to a non compete":       p => scr(p, "nonCompete"),
    // "do you HOLD one" is No; "are you willing/able to OBTAIN one" is not
    "security clearance":             (p, f) =>
      /willing|obtain|able to|eligib/.test(lbl(f)) ? "" : scr(p, "securityClearance"),
    "united states citizen":          usCitizen,
    "related to a current":           p => scr(p, "relatedToCurrentEmployee"),
    // Answer "Yes" only if you actually run or hold a stake in another
    // business, and expect it to be listed in your employment history too.
    "engaged or involved in any other business": p => scr(p, "otherBusiness"),
    // Websites section ("URL*"): leads with GitHub, then portfolio, then LinkedIn.
    "url":                            p => (p.links &&
                                        (p.links.github || p.links.portfolio ||
                                         p.links.linkedin)) || "",
    "website":                        p => (p.links && p.links.github) || "",
    "do you have decision making":    p => scr(p, "decisionMakingAuthority"),
    "if so do you have decis":        p => scr(p, "decisionMakingAuthority"),
    "representative at a recruiting event": p => scr(p, "metRecruiterAtEvent"),
    "met with a recruiter":           p => scr(p, "metRecruiterAtEvent"),
    "first robotics":                 p => scr(p, "firstRobotics"),
    // Professional-conduct screener.
    "subject to any disciplinary":    p => scr(p, "disciplinaryAction"),
    "disciplinary or corrective action": p => scr(p, "disciplinaryAction"),
    // Federal-contractor "check all that apply" lists: none apply, and ""
    // (never false) so a box you ticked by hand is left alone.
    "yes employed by the federal government": p => "",
    "yes served in the military":     p => "",
    "yes political appointee":        p => "",
    "yes performed work for the dha": p => "",
    "other":                          p => "",   // catch-all box on skill lists
    "class standing":                 p => (p.application && p.application.classStanding) || "",
    "which college or university":    p => p.education[0] && p.education[0].school,
    // (technology-list checkboxes like "Java, SQL, C#, C/C++, Python, etc."
    //  are answered by the skills-list pattern rule below, from profile.skills)
    "hold a leadership position":     p => scr(p, "leadershipPosition"),
    // Two different questions share this wording. "…at THIS company?" is
    // answered from workAuth.previouslyEmployedAt; "…at an organization?" is
    // the generic one and comes from screening.completedInternship.
    "previously completed an internship": (p, f) => {
      const t = location.hostname.split(".")[0].toLowerCase();
      const lbl = ((f && f.label) || "").toLowerCase();
      return lbl.includes(t) ? prevEmployed(p) : scr(p, "completedInternship");
    },
    "work experience in the past 24 months": p => scr(p, "workExperience24Months"),
    "involved in extracurricular activities": p => scr(p, "extracurriculars"),
    "volunteered in your community":  p => scr(p, "volunteered"),
    "related to anyone":              p => p.workAuth.relativesAtCompany,
    "related to any current":         p => p.workAuth.relativesAtCompany,

    // Per-application
    "desired salary":                 p => p.application.desiredSalary,
    "salary expectation":             p => p.application.desiredSalary,
    "expected salary":                p => p.application.desiredSalary,
    "salary requirement":             p => p.application.desiredSalary,
    // Plural phrasings are separate keys — the matcher is word-boundary
    // exact, so "salary expectations" never matches "salary expectation".
    "salary expectations":            p => p.application.desiredSalary,
    "salary requirements":            p => p.application.desiredSalary,
    "compensation expectations":      p => p.application.desiredSalary,
    // Travel (some tenants ask for a band, others ask yes/no)
    "willing and able to travel":     p => p.application.willingToTravel,
    "willing to travel":              p => p.application.willingToTravel,
    "able to travel":                 p => p.application.willingToTravel,
    "percentage of time are you willing to travel": p => p.application.travelPercentage,
    "percentage of travel":           p => p.application.travelPercentage,
    "reason for leaving":             p => p.application.reasonForLeaving,
    "earliest start date":            p => p.application.earliestStartDate,
    "date available":                 p => p.application.earliestStartDate,
    "available start date":           p => p.application.earliestStartDate,
    "when would you be available":    p => p.application.earliestStartDate,
    "available to start":             p => p.application.earliestStartDate,
    "willing to relocate":            p => p.application.willingToRelocate,
    "how did you hear":               p => p.application.howDidYouHear,

    // EEO / self-identification
    "gender":                         p => p.eeo.gender,
    "sex":                            p => p.eeo.gender,
    "race":                           p => p.eeo.raceEthnicity,
    "ethnicity":                      p => p.eeo.raceEthnicity,
    "race ethnicity":                 p => p.eeo.raceEthnicity,
    "hispanic or latino":             p => p.eeo.hispanicLatino,
    "veteran status":                 p => p.eeo.veteranStatus,
    "veterans status":                p => p.eeo.veteranStatus,
    "protected veteran":              p => p.eeo.veteranStatus,
    // The matcher is word-boundary exact, so the PLURAL phrasings need their
    // own keys ("…one of the following protected veterans?" missed, live
    // 2026-09-10). The option text varies per tenant — optionSynonyms maps
    // "I am not a protected veteran" onto "I am not a veteran" and friends.
    "protected veterans":             p => p.eeo.veteranStatus,
    "identify as one of the following": p => p.eeo.veteranStatus,
    "veteran classifications":        p => p.eeo.veteranStatus,
    "read and consent to the terms":  p => p.application.agreeToTerms,
    // "By selecting the checkbox, you agree to our Terms and Conditions and
    // Applicant Privacy Policy" (live 2026-09-10) — no automation-id on that
    // tenant, so it has to match on the label.
    "you agree to our terms":         p => p.application.agreeToTerms,
    "agree to our terms":             p => p.application.agreeToTerms,
    "terms and conditions":           p => p.application.agreeToTerms,
    "applicant privacy policy":       p => p.application.agreeToTerms,
    "applicant privacy notice":       p => p.application.agreeToTerms,
    "by selecting the checkbox":      p => p.application.agreeToTerms,
    "disability status":              p => p.eeo.disabilityStatus,

    // CC-305 disability checkboxes — each box maps to one stored answer
    // Anchored, and "" (never false) for the boxes that don't apply: a
    // substring test read "I do not want to answer" as containing "no".
    "yes i have a disability":        p => /^yes\b/.test(ds(p)) ? true : "",
    "no i do not have a disability":  p => /^no\b/.test(ds(p)) ? true : "",
    "i do not want to answer":        p => /not want to answer|prefer not|decline/.test(ds(p)) ? true : "",

    // Misc (empty-string resolvers = intentionally skipped, not "unmapped")
    "i have a preferred name":        p => "",
    "phone extension":                p => "",
    // Per-employer reference fields (seen on some tenants) — need per-job data we
    // don't store yet; left for review rather than guessed.
    "name of your manager":           p => "",
    "location did you work at":       p => "",
    "what was your employee id":      p => "",
    "employee id":                    p => "",
    "type to add skills":             p => "",
    "suffix":                         p => "",   // no suffix
    // Job-specific ("…within X miles of this posting?") — never guessed.
    "do you reside in the location":  p => "",
    // Marketing/SMS consent is a preference, not a fact: "" until you sets it
    "consent to receive periodic automated text messages": p => p.personal.smsOptIn,
    "text messages":                  p => p.personal.smsOptIn,
    // Language rows are filled by fillLanguageSection (it can tell WHICH
    // language a row is for); a stray top-level box is left alone.
    "i am fluent in this language":   p => "",
    "gpa":                            p => p.education[0] && p.education[0].gpa,
    "grade point average":            p => p.education[0] && p.education[0].gpa,
    "gpa 3 0 or above":               p => scr(p, "gpaAbove30"),
    "currently in process of completing": p => scr(p, "currentlyEnrolled"),
    // the B.S. is in progress: "highest degree EARNED" is not the B.S.
    "degree":                         (p, f) =>
      /highest|earned|completed|obtained/.test(lbl(f)) ? ""
        : p.education[0] && p.education[0].degree,
    "field of study":                 p => p.education[0] && p.education[0].fieldOfStudy,
    "school or university":           p => p.education[0] && p.education[0].school,
    "date":                           () => today(),
    "today s date":                   () => today(),
  };

  // ---- 3. Pattern rules (consulted only after id + label lookups miss) -----
  // Narrow, explicit shapes — still never a guess: every answer comes out of
  // the profile. A rule that can't answer from the profile returns "".
  const byPattern = [
    {
      // "Java, SQL, C#, C/C++, Python, etc." — one checkbox per technology
      // family. Ticked only when one of the listed items is in profile.skills.
      name: "skills-list checkbox",
      test: (f) => f.kind === "checkbox" && skillTokens(f.label).length >= 2,
      resolve: (p, f) => hasAnySkill(p, skillTokens(f.label)),
    },
  ];

  // ---- Option-text synonyms for dropdown/radio matching --------------------
  // Keyed by normalized profile value → list of normalized alternatives.
  const optionSynonyms = {
    "united states of america": ["united states", "usa", "us"],
    "mobile": ["cell", "personal mobile", "mobile phone", "cellular", "personal cell"],
    "yes": ["y"],
    "no": ["n"],
    // Degree lists are wildly inconsistent between tenants ("Bachelors",
    // "Bachelor's Degree", "Bachelor of Science", "BS/BA", "Undergraduate").
    // Ordered strongest → weakest; nothing here claims a degree he doesn't
    // hold (no bare "Bachelor", which would happily match "Bachelor of Arts").
    "bachelor of science b s": ["bachelor of science", "bachelor of science bs",
      "bachelors", "bachelor s", "bachelors degree", "bachelor s degree",
      "bs", "bs ba", "ba bs", "undergraduate degree", "undergraduate",
      "4 year degree", "four year degree"],
    "high school diploma": ["high school", "high school diploma or ged",
                            "high school or equivalent", "secondary school"],
        "senior": ["college senior", "university senior", "4th year", "fourth year",
               "rising senior", "senior 4th year"],
    "i am not a protected veteran": ["i am not a veteran"],
    // Language proficiency option sets differ per tenant (Workday's own
    // scale vs. the LinkedIn-style scale) — cascade from strongest down.
    "native": ["native or bilingual", "native or bilingual proficiency",
               "fluent", "full professional proficiency", "advanced", "expert"],
    "fluent": ["native or bilingual", "native", "full professional proficiency",
               "advanced", "expert"],
    // How-did-you-hear lists are tenant-specific; honest cascade only —
    // never claims a job board or referral we didn't use.
    "company website": ["career site", "careers site", "careers page",
      "corporate website", "company careers", "website", "web site",
      "online", "internet", "other"],
  };

  // Dropdown button texts that mean "nothing selected yet".
  const placeholders = new Set(["", "select one", "select", "please select",
    "search", "select all that apply"]);

  // One-word keys that are only safe as the WHOLE label: contains-matching
  // "date" filled Date of Birth / Start Date with today, and "name" filled
  // Emergency Contact Name / Name of School with his name.
  const exactOnly = new Set(["name", "date"]);

  return { byAutomationId, byLabel, byPattern, optionSynonyms, placeholders,
           exactOnly };
})();
