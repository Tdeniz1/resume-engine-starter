# Copy-paste prompt: tailor a resume

For terminal agents that do not support skills or slash commands (Codex CLI,
Aider, Gemini CLI, Cursor agent, plain chat with file access). Run your agent
from the repo root, then paste this, followed by the job description.

---

Read AGENTS.md in this repo, then follow the "Procedure: tailor" section
exactly, for the job description below.

Specifically: create the application folder, save the JD to jd.txt, read all of
data/, write applications/<slug>/tailored.yaml referencing master ids only,
run `python3 scripts/validate.py` on it, fix any errors, then run
`scripts/render.sh applications/<slug>` and tell me the PDF path plus what you
emphasized and why.

Do not invent anything. Every bullet must be a rewrite of content already in
data/, with metrics verbatim. If something would help but is not in data/, ask
me whether it is true before using it.

JOB DESCRIPTION:

<paste the job description here>
