---
name: tailor
description: Generate a tailored one-page resume PDF for a specific job. Use when the user pastes a job title or description, shares a job posting link, or asks for a resume for a role.
---

# Tailor a resume to a job

Read `AGENTS.md` in the repo root first if you have not already. It holds the
hard rules this skill assumes.

## Inputs

Take from the user's message, or ask for: the **job description** (pasted
text, a URL, or a file) and the **company name**. Derive a short role tag for
the filename ("Forward Deployed Engineer" becomes `FDE`, "Senior Software
Engineer" becomes `SWE`). Confirm the tag only if genuinely ambiguous.

## Steps

1. **Set up the application folder.** Slug is lowercase `company-role`, e.g.
   `applications/acme-data-analyst/`. Save the job description verbatim to
   `jd.txt` there.

2. **Read ALL master data** in `data/`: profile, experience, education,
   skills, projects, publications, honors, certifications. If any file still
   contains `sample-*` ids or `FILL_ME`, STOP and run `/intake` first.

3. **Analyze the job description.** Extract must-have skills, nice-to-haves,
   seniority, the keywords an ATS would scan for, and what the role actually
   rewards: shipping speed, client-facing polish, research rigor, ownership.

4. **Write `tailored.yaml`** in the application folder, using the schema in
   `AGENTS.md` (or copy the shape of `applications/_example/tailored.yaml`).

   Non-negotiable:
   - **Never invent.** Every entry references a master id. Every bullet is a
     rewrite of content in that entry. Numbers verbatim from master data.
   - **Respect provenance flags** in each entry's `details`. VERIFIED
     preferred, CLAIMED allowed, CONFLICT forbidden. Follow any standing rule
     lines the user has written there, including entries to leave off by
     default and entries to ask about before including.
   - **No em dashes** anywhere that renders. Comma, colon, semicolon, or
     parentheses instead. En dashes in ranges are fine.
   - **Reverse chronological** within every dated section. Relevance decides
     which entries appear and how many bullets each gets, never their order.
   - Target 12 to 16 bullets total. Cut the least relevant entries entirely
     rather than shrinking everything.
   - Order SECTIONS to lead with the strongest case for THIS job. Projects
     before experience for a research role; experience first for consulting.
   - Rephrase bullets to mirror the job description's own vocabulary wherever
     that is honest.

5. **Validation** runs automatically via the PostToolUse hook when you write
   `tailored.yaml`. If it errors, fix the tailored file. If a fact is real but
   missing from master data, ask the user, add it to `data/`, then retry.

6. **Render:** `scripts/render.sh applications/<slug>`. This validates again,
   compiles the PDF with the canonical filename, and checks the page count.
   If it is 2 pages, trim bullets and re-render until it is 1.

7. **Deliver:** `open` the PDF (or give the full path), then 2 or 3 lines on
   what you emphasized and why. Offer tweaks.

8. **Commit** the application folder so there is a record of what was sent
   where: `git add applications/<slug> && git commit`. Push if a remote is
   configured and the repo is private.
