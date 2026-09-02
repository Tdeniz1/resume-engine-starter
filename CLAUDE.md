# resume-engine (Claude Code)

**Read `AGENTS.md` first. It is the full spec** covering the architecture, the
hard rules, and the step-by-step intake and tailor procedures. Everything in
it applies here.

Claude-specific notes:

- **Skills:** `/tailor` builds a resume for a job. `/intake` loads the user's
  history from `intake/PASTE_YOUR_INFO.md` into `data/*.yaml`.
- **Validation hook:** `.claude/settings.json` registers a PostToolUse hook
  that runs `scripts/validate.py` every time you write a `tailored.yaml`. If
  it fails, the errors come straight back to you. Fix the tailored file, or
  add the missing fact to `data/` if it is real.
- **A pasted job description is a `/tailor` request.** If the user's message
  is just a job description, or a link to one, with no command, invoke the
  tailor skill immediately. Do not ask what they want.
- **Anything the user tells you about their career in this repo goes into
  `data/` in the same turn.** A metric mentioned in passing and not written
  down is a metric lost.
