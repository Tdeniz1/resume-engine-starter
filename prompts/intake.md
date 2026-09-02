# Copy-paste prompt: load my career history

For terminal agents that do not support skills or slash commands. Fill in
intake/PASTE_YOUR_INFO.md first, then run your agent from the repo root and
paste this.

---

Read AGENTS.md in this repo, then follow the "Procedure: intake" section
exactly.

Read intake/PASTE_YOUR_INFO.md and convert everything in it into the
data/*.yaml schema, matching the shape of the shipped sample entries. Replace
every FILL_ME in data/profile.yaml and delete every sample- entry you replace.

Write master data LONG: keep every number, scope detail, and stakeholder,
because this file is never trimmed for length and the per-job tailoring step
cuts later.

Flag provenance in each entry's `details` field as VERIFIED, CLAIMED, or
CONFLICT. Ask me about anything vague, and ask me how I know any number that
looks suspiciously round. Do not guess at titles, dates, or degree framing.

When you are done, build a throwaway test application against my new data,
confirm it validates and renders to one page, delete the throwaway, and tell
me what you loaded and what you still need from me.
