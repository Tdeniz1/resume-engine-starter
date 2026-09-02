# resume-engine: agent instructions

You are operating a resume tailoring engine. A job description goes in, a
validated one-page PDF comes out. Read this whole file before doing anything.

This file is the canonical spec. It is read automatically by Codex, Cursor,
Aider, Gemini CLI, and most other terminal agents. Claude Code reads
`CLAUDE.md`, which points here.

## The core idea

Master data and presentation are separated on purpose.

- `data/*.yaml` holds every fact about the user, written long and detailed.
  This is the single source of truth.
- `applications/<slug>/tailored.yaml` is the ONLY file you write per job. It
  is a selection and rephrasing of master content that references master
  entries **by id**.
- `templates/resume.typ` renders deterministically. Employer names, titles,
  dates, and schools are pulled from `data/` by id at render time, so a
  tailored file **physically cannot invent a job the user never had**.
- `scripts/validate.py` is the anti-hallucination gate. Unknown ids, numbers
  that do not appear in the referenced master entry, and skills outside the
  master inventory are hard errors that block rendering.
- `config.yaml` holds the user's formatting and rule preferences.

## Hard rules

1. **NEVER invent, embellish, or round.** Every bullet must be a rewrite of
   content that already exists in `data/`. Metrics must be verbatim. If a
   claim would help but is not in `data/`, ask the user whether it is true.
   If yes, add it to master data first. If no, drop it.
2. **Rewriting is allowed; inflating is not.** You may compress, reorder,
   change voice, and mirror the job description's vocabulary. You may not
   change what a number means, widen a scope, upgrade a title, or turn
   "supported" into "led".
3. **Respect provenance flags** in each master entry's `details` field.
   VERIFIED numbers are preferred. CLAIMED is allowed. CONFLICT numbers are
   forbidden until the user resolves them. Follow any explicit rule lines the
   user has written there, such as which entries to leave off by default.
4. **One page**, unless `config.yaml` says otherwise. Cut whole entries before
   shrinking everything. A resume with 3 strong entries beats one with 6 thin
   ones.
5. **Never compile with `typst` directly.** `scripts/render.sh` is the only
   build path, because it runs validation first. Never hand-name a PDF.
6. **Never edit `templates/resume.typ` per application.** Layout changes are
   global and go in the template or `config.yaml`, never in a tailored file.
7. **No em dashes** anywhere that renders on a resume. Use a comma, colon,
   semicolon, or parentheses. En dashes in ranges are fine. Enforced by
   `validate.py`, toggleable in `config.yaml`.
8. **Every dated section is reverse chronological.** Ongoing entries first
   (newest start first), then by end date. Relevance decides WHICH entries
   appear and how many bullets each gets, never their order. Enforced by
   `validate.py`, toggleable in `config.yaml`.
9. **When the user mentions new experience, skills, wins, or metrics in any
   conversation in this repo, add them to `data/` immediately**, long-form
   with all detail. Master data richness is what makes tailoring good.
10. **`data/` edits append and enrich, they do not delete history.** Old jobs
    stay. The tailoring step decides what to omit per application.

## Procedure: intake (first run)

Trigger: the user runs `/intake`, says they want to set up their data, or has
filled in `intake/PASTE_YOUR_INFO.md`.

1. Read `intake/PASTE_YOUR_INFO.md` in full. If it is still the untouched
   template, ask the user to fill it in or to paste their resume and LinkedIn
   directly into the chat, and work from that instead.
2. Extract everything into the `data/*.yaml` schema. Write `data/profile.yaml`
   first, then `experience`, `education`, `projects`, `skills`, `honors`,
   `certifications`, `publications`. Match the shape of the shipped sample
   entries exactly.
3. **Delete every `sample-*` entry** you have replaced. Leave a file with an
   empty list (`[]`) if the user genuinely has nothing for that section.
4. Write bullets LONG. Master data is not a resume. Preserve every number, every
   scope detail, every stakeholder. The tailoring step will cut later.
5. Put provenance in each entry's `details` field: VERIFIED, CLAIMED, or
   CONFLICT, plus any standing rule the user gave you.
6. **Interrogate the numbers.** For anything vague ("improved efficiency",
   "worked on a large dataset"), ask for the actual figure. For anything that
   sounds too round or too convenient, ask how they know it. This is the one
   step where the user is the weak link in the honesty chain, so do the work
   here rather than letting a soft claim harden into a resume line.
7. Confirm anything ambiguous rather than guessing. Titles, dates, and degree
   framing are the usual traps.
8. Smoke-test when done: build a throwaway application against the new data,
   confirm it validates and renders to one page, then delete the folder.
9. Tell the user what you loaded, what you flagged as CLAIMED, and what you
   still need from them.

## Procedure: tailor (every job)

Trigger: the user runs `/tailor`, or simply pastes a job description with no
command. **A pasted job description is a `/tailor` request.** Do not ask what
they want, just run this.

1. **Set up the application folder.** Slug is lowercase `company-role`, for
   example `applications/acme-data-analyst/`. Save the job description
   verbatim to `jd.txt` in that folder.
2. **Read ALL of `data/`.** If any file still has `sample-*` ids or
   `FILL_ME`, STOP and run intake first.
3. **Analyze the job description.** Extract must-have skills, nice-to-haves,
   seniority, the keywords an ATS will scan for, and what the role actually
   rewards. A job that rewards shipping speed and one that rewards rigor pull
   different bullets out of the same history.
4. **Write `applications/<slug>/tailored.yaml`.** Schema:

   ```yaml
   meta:
     company: Acme Corp            # display capitalization, used in filename
     role: Data Analyst
     role_short: DataAnalyst       # used in filename
     date: <today>
   summary: One to three sentences aimed at THIS role. Optional.
   experience:
     - from: <master id>
       bullets:
         - "Rewritten bullet drawn from that master entry"
   projects:
     - from: <master id>
       bullets: ["..."]
   education:
     - from: <master id>
       coursework: [only, if, relevant]   # optional
   skills:
     - category: "..."
       items: [subset, of, master, skills]
   publications: [<master id>]     # id list, rendered verbatim from master
   honors: [<master id>]
   certifications: [<master id>]
   section_order: [summary, experience, projects, publications, education, skills, honors, certifications]
   ```

   Choices you should be making:
   - Target 12 to 16 bullets total. Cut the least relevant ENTRIES rather than
     trimming every bullet into mush.
   - Reorder SECTIONS to lead with the strongest case for this specific job.
     Projects before experience for a research role. Experience first for a
     consulting role. Drop sections entirely when they do not help.
   - Mirror the job description's own vocabulary wherever it is honest to do
     so. If they say "stakeholder management" and the user wrote "worked with
     leadership", use their phrase.
   - Older or weaker roles get one bullet or get omitted.
5. **Validation** runs automatically on write if the user's agent supports
   hooks. If not, run it yourself:
   `python3 scripts/validate.py applications/<slug>/tailored.yaml`
   Fix the tailored file when it errors. If a fact is real but missing from
   master data, ask the user, add it to `data/`, then retry.
6. **Render:** `scripts/render.sh applications/<slug>`. This validates again,
   compiles the PDF, and checks the page count. If it is 2 pages, trim and
   re-render until it fits.
7. **Deliver:** open the PDF or tell the user the exact path, then give 2 or 3
   lines on what you emphasized and why. Offer tweaks.
8. **Commit** the application folder so there is a permanent record of what
   was sent where: `git add applications/<slug> && git commit`.

## The Workday autofill extension (workday-autofill/)

⚠️ **WORK IN PROGRESS. This half of the repo is unfinished and needs ongoing
maintenance. Say so plainly whenever the user asks you to work on it, and do
not describe it as done, complete, or reliable.**

A local Chrome extension that fills Workday application forms from
`workday-autofill/profile.js`. It fills and stops; it never submits.

What you need to know before touching it:

1. **It will go stale, permanently.** `src/mappings.js` is a snapshot of
   Workday `data-automation-id` values and question wording at the time it was
   written. Workday changes its DOM and every employer customizes their tenant,
   so unmapped fields and broken selectors are the expected steady state, not a
   bug report. Extending mappings is routine maintenance, and the user should
   expect to keep doing it.
2. **NEVER hardcode an answer in `src/mappings.js`.** Not "Yes", not "No", not
   a class standing, not a degree level. Every mapping must read from
   `profile.js`, and must return `""` when the relevant field is unset so the
   engine skips the question and leaves it for the human. A literal answer in
   a mapping table answers a legal question identically for everyone who ever
   installs this. If a question has no home in the profile, add a field to the
   `screening` block, defaulted to `""`.
3. **These are legal attestations.** Citizenship, work authorization, veteran
   and disability status, non-competes, criminal history. Blank is always an
   acceptable output. A confidently wrong answer is not. When in doubt, leave
   it for the user and tell them which questions you left.
4. **Never add code that clicks Submit, Next, or Continue.** The fill-and-stop
   boundary is the whole safety model. If the user asks for auto-advance, say
   what it costs them: no review step before an application is filed under
   their name.
5. **`profile.js` ships blank and must stay that way in the repo.** If the
   user fills it in, that file holds their home address, phone number, and EEO
   answers. Never commit a filled-in copy, and never paste its contents into
   an issue, a commit message, or any other repo.
6. **Keep it consistent with `data/*.yaml`.** Employers, titles, and dates in
   `profile.js` should match the resume engine's master data exactly. The form,
   the resume, and a future background check all have to tell the same story.
   If you change one, offer to update the other.

## When the user pushes back

If the user asks you to add something that is not in master data, the answer
is not "no". It is: "Is that true? If so I will add it to your master data
first, then use it." If they confirm it is true, load it into `data/` with a
CLAIMED flag and proceed. If they will not confirm it, leave it off and say so
plainly once.

The engine's only real job is making sure the resume and the truth never drift
apart. Everything else is formatting.
