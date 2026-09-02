// ============================================================================
// PROFILE — the ONLY file you should ever need to edit.
//
// ⚠️  THIS FILE SHIPS BLANK ON PURPOSE. ⚠️
//
// Every value below is empty until you fill it in. That is deliberate: this
// extension types answers into real job applications, and several of those
// answers are legal attestations (citizenship, work authorization, veteran
// status, non-competes). A tool that guesses on your behalf is worse than no
// tool at all.
//
// Rules the engine follows:
//   - A value of ""  means "skip this field silently". Nothing is ever guessed.
//   - Dates are strings: "MM/YYYY" or "MM/DD/YYYY" or "YYYY".
//   - Yes/No questions take the literal string "Yes" or "No".
//   - An experience/education entry with  include: false  is never filled.
//
// PRIVACY: once you fill this in it holds your home address, phone number,
// and EEO answers. Do not commit it to a public repo. The repo's .gitignore
// does NOT ignore it by default, because the extension will not load without
// it. Keep your copy private.
//
// If you also use the resume-engine in this repo, your experience and
// education blocks should match data/*.yaml exactly, so the form, the resume,
// and any background check all tell the same story.
// ============================================================================

window.WDAF_PROFILE = {

  personal: {
    firstName: "",
    middleName: "",
    lastName: "",
    preferredName: "",
    email: "",
    phone: "",                              // digits only, e.g. "5551234567"
    phoneType: "Mobile",                    // Workday device-type dropdown
    phoneCountryCode: "United States of America (+1)",
  },

  address: {
    line1: "",
    line2: "",
    city: "",
    state: "",                              // full name, e.g. "South Carolina"
    postalCode: "",
    country: "United States of America",
  },

  links: {
    linkedin: "",
    github: "",
    portfolio: "",
    orcid: "",
  },

  // ---- Work authorization / screening questions ----------------------------
  // These are legal attestations. Answer them yourself or leave them blank.
  workAuth: {
    legallyAuthorized: "",                  // "Yes" / "No"
    requireSponsorship: "",                 // "Yes" / "No"
    citizenship: "",                        // e.g. "United States of America"
    over18: "",                             // "Yes" / "No"
    // "Have you worked for THIS employer before?" is answered per tenant:
    // any hostname starting with an entry below gets "Yes", everyone else
    // gets the previouslyEmployed value. Leave the list empty if you have
    // never worked for a company you are applying to.
    previouslyEmployed: "",                 // default answer
    previouslyEmployedAt: [],               // e.g. ["acme", "globex"]
    relativesAtCompany: "",                 // "Yes" / "No"
  },

  // ---- Voluntary self-identification (EEO) ---------------------------------
  // 100% optional, and blank is a perfectly good answer. Fill each with the
  // EXACT option text you want picked (partial match is fine, so "prefer not"
  // will find "I do not wish to answer"). Blank = the extension skips the
  // field entirely and you answer it by hand, or not at all.
  eeo: {
    gender: "",
    raceEthnicity: "",
    hispanicLatino: "",
    veteranStatus: "",
    disabilityStatus: "",                   // CC-305 form
  },

  // ---- Screening questions -------------------------------------------------
  // Workday tenants ask these constantly and the honest answer differs per
  // person, so NONE of them have a default. Blank means the extension leaves
  // the question for you. Fill in only the ones that are true for you.
  screening: {
    usCitizen: "",                          // "Yes" / "No"
    securityClearance: "",
    boundByAgreement: "",                   // non-compete, NDA, restrictive covenant
    nonCompete: "",
    ongoingNegotiations: "",                // conflict-of-interest screeners
    otherBusiness: "",                      // "engaged in any other business?"
    governmentAgencyEmployment: "",
    governmentOfficialFamily: "",
    relatedToCurrentEmployee: "",
    decisionMakingAuthority: "",
    metRecruiterAtEvent: "",
    firstRobotics: "",
    leadershipPosition: "",
    extracurriculars: "",
    volunteered: "",
    workExperience24Months: "",
    completedInternship: "",                // "have you completed an internship?"
    coreProgrammingLanguages: "",           // "do you know Java/SQL?" style
    gpaAbove30: "",
    currentlyEnrolled: "",
    highestDegreeCompleted: "",             // e.g. "High School Diploma"
  },

  // ---- Per-application answers ---------------------------------------------
  application: {
    desiredSalary: "",                      // per job; blank = answer by hand
    earliestStartDate: "",                  // "MM/DD/YYYY"
    willingToRelocate: "",                  // "Yes" / "No"
    howDidYouHear: "",                      // e.g. "Company Website"
    classStanding: "",                      // e.g. "Senior" (students only)
    agreeToTerms: "",                       // "Yes" auto-checks step-1 consent
  },

  // ---- Education (reverse-chronological) -----------------------------------
  education: [
    {
      school: "",
      degree: "",                           // e.g. "Bachelor of Science (B.S.)"
      fieldOfStudy: "",
      startDate: "",                        // "MM/YYYY"
      endDate: "",
      gpa: "",                              // the real one. Blank to omit.
      description: "",                      // minors, honors, distinctions
    },
    {
      include: false,                       // flip to true only if a form demands high school
      school: "",
      degree: "High School Diploma",
      fieldOfStudy: "",
      startDate: "",
      endDate: "",
      gpa: "",
      description: "",
    },
  ],

  // ---- Work experience (reverse-chronological, canonical record) -----------
  // Workday's resume parser mangles dates and titles, so the engine
  // OVERWRITES these blocks after an upload. Whatever you put here wins,
  // which is exactly why it has to be accurate.
  experience: [
    {
      company: "",
      title: "",
      location: "",
      startDate: "",                        // "MM/YYYY"
      endDate: "",                          // blank when current: true
      current: false,
      bullets: [
        "",
      ],
    },
    // Copy the block above for each role. Add  include: false  to keep a role
    // in the file but off applications by default.
  ],

  skills: [],

  languages: [
    // { language: "English", fluency: "Native" },
  ],

  certifications: [
    // { name: "", issuer: "", year: "" },
  ],

  references: [
    // { name: "", title: "", company: "", email: "", phone: "", relationship: "" },
  ],
};
