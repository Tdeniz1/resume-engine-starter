---
name: intake
description: Load the user's career history into master data. Use on first setup, when the user has filled in intake/PASTE_YOUR_INFO.md, when they paste a resume or LinkedIn profile, or when they want to add a new job, skill, project, or metric to their master data.
---

# Load career history into master data

Read `AGENTS.md` in the repo root first if you have not already.

This skill fills `data/*.yaml`, the single source of truth every resume is
built from. Everything downstream depends on this being rich and honest.

## Steps

1. **Find the input.** In order of preference:
   - `intake/PASTE_YOUR_INFO.md`, if the user has filled it in
   - a resume, LinkedIn dump, or CV the user pasted into the conversation
   - a file they pointed you at

   If `PASTE_YOUR_INFO.md` is still the untouched template and the user pasted
   nothing, ask them to fill it in or to paste their resume and LinkedIn
   directly, and work from that.

2. **Write `data/profile.yaml` first.** Replace every `FILL_ME`. Leave a field
   as `""` to omit it from the header. Never add date of birth, home address,
   photo, or nationality.

3. **Fill the rest of `data/`:** experience, education, projects, skills,
   honors, certifications, publications. Match the shape of the shipped sample
   entries exactly. Ids are stable kebab-case and are what tailored resumes
   reference, so pick them once and do not rename them later.

4. **Delete every `sample-*` entry you replaced.** If the user genuinely has
   nothing for a section, leave that file as an empty list (`[]`) rather than
   leaving samples behind. Validation blocks any resume that still references
   a sample id.

5. **Write bullets LONG.** Master data is not a resume and is never trimmed
   for length. Keep every number, scope detail, tool, and stakeholder. One
   master entry might hold 8 bullets that no single resume ever shows in full.

6. **Interrogate the numbers.** This is the step that decides whether the
   whole system is honest, because the validator can stop you from inventing
   facts but cannot stop the user.
   - Vague claims get a question: "improved efficiency" becomes "by how much,
     measured how?"
   - Suspiciously round or convenient numbers get a question about how they
     know it. A number recalled from a dashboard is different from a number
     that "sounds about right".
   - Record the answer as a provenance flag in the entry's `details`:
     **VERIFIED** (an artifact exists), **CLAIMED** (true to memory, no
     document), **CONFLICT** (two sources disagree, unusable until resolved).
   - Never quietly upgrade a CLAIMED number to VERIFIED.

7. **Capture standing rules** from section 9 of the intake file, or anything
   the user says in passing, into the relevant entry's `details` field.
   Examples: which GPA to state and never round, which venture to leave off by
   default, which framing of a degree to use. These notes never render, and
   they are what makes the engine behave consistently months later.

8. **Smoke-test.** Build a throwaway application against the new data, confirm
   `scripts/validate.py` passes and `scripts/render.sh` produces one page, then
   delete the throwaway folder.

9. **Report back:** what you loaded, what you flagged CLAIMED or CONFLICT, and
   what you still need from them.

## Incremental updates

This skill also handles "I just got promoted", "here is a metric I forgot",
and "I finished that project". Append and enrich; never delete history. Old
jobs stay in master data forever, and the tailoring step decides what to omit.
