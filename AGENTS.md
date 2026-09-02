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

## When the user pushes back

If the user asks you to add something that is not in master data, the answer
is not "no". It is: "Is that true? If so I will add it to your master data
first, then use it." If they confirm it is true, load it into `data/` with a
CLAIMED flag and proceed. If they will not confirm it, leave it off and say so
plainly once.

The engine's only real job is making sure the resume and the truth never drift
apart. Everything else is formatting.
