# Workday Autofill

A local Chrome extension that fills Workday job applications from `profile.js`
the moment a step renders. No network calls, no LLM calls, no build step. It
**fills and stops**: it never clicks Submit, Next, or Continue.

---

> # ⚠️ WORK IN PROGRESS. READ THIS BEFORE YOU USE IT. ⚠️
>
> **This is unfinished software and it will need ongoing maintenance. Treat
> every run as something you personally review before submitting.**
>
> - **It is built against a handful of Workday tenants, not all of them.**
>   Every employer customizes their Workday instance: different field ids,
>   different question wording, extra steps. Fields this extension has never
>   seen are simply left blank. Expect gaps on your first application at any
>   new company.
> - **Workday changes its DOM, and when it does, this breaks.** The selectors
>   and `data-automation-id` values in `src/mappings.js` are a snapshot of
>   what Workday looked like when they were written. There is no version of
>   this tool that stays correct without being updated.
> - **You are legally responsible for every answer on the form.** Job
>   applications include attestations about citizenship, work authorization,
>   criminal history, non-competes, and veteran and disability status. A
>   wrong answer is your problem, not the tool's, and "the extension filled
>   it in" is not a defense.
> - **Read the whole form before you submit. Every time.** Filled fields
>   flash green so you can see what was touched, and the badge shows a
>   filled/skipped count. That is a review aid, not a guarantee.
> - **Nothing is guessed.** A blank value in `profile.js` means the field is
>   skipped and left for you. `profile.js` ships completely blank on purpose.
>   If a question is not answered, that is the tool working correctly.
> - **It never submits.** By design there is no code path that clicks Submit,
>   Next, or Continue. Do not add one.
>
> If any of that is more risk than you want, fill your applications by hand.
> This exists to remove typing, not judgment.

---

## Setup

1. Fill in `profile.js`. It ships blank. Everything you leave empty is a
   field the extension will skip.
2. Chrome, go to `chrome://extensions`
3. Turn on **Developer mode**, top right
4. **Load unpacked**, select this `workday-autofill` folder
5. After editing any file, hit the reload icon on the extension card, then
   refresh the Workday tab.

`profile.js` is the only file you need to touch day to day. Once filled it
contains your home address, phone number, and EEO answers, so keep your copy
of this repo private.

## Shortcuts (Option = ⌥)

| Keys | Action |
|---|---|
| ⌥⇧F | Fill the current step now |
| ⌥⇧A | Toggle auto-fill on and off for this tab |
| ⌥⇧J | Copy the job description, for the resume engine |
| ⌥⇧U | Dump unmapped fields to the console as paste-ready mapping lines |
| ⌥⇧X | Clear the unmapped-field log |

The badge bottom-right shows `filled · skipped · AUTO ON/OFF`. Filled fields
flash green for about 1.5 seconds so you can verify at a glance.

## Pairing it with the resume engine

This folder lives inside the [resume-engine](../README.md) repo because the
two halves fit together:

1. On the job posting, press **⌥⇧J**. The job description, role, and URL go
   to your clipboard.
2. In the repo root, start your agent and paste. A bare pasted job
   description runs `/tailor` and produces a validated one-page PDF.
3. Back in Workday, drag that PDF onto the upload box. It gets a dashed
   green outline when it appears.
4. Let Workday parse the resume, then let the autofill overwrite the
   experience and education blocks. Workday's parser mangles dates and
   titles; `profile.js` wins on purpose.

Keep `profile.js` and `data/*.yaml` in agreement. If the form, the resume,
and a future background check disagree with each other, that is the one
failure mode this whole repo exists to prevent.

## Extending it: learning mode

Every field the extension does not recognize is recorded automatically, with
its automation-id, label, type, and tenant. Open DevTools (⌘⌥J) and press
**⌥⇧U** to get paste-ready lines:

```
'selfIdentifiedDisabilityData': p => "",  // label: "Disability Status" | dropdown | acme.wd5.myworkdayjobs.com | seen 3×
```

Paste into `src/mappings.js`, in `byAutomationId` or in `byLabel` for
label-only captures, and replace `""` with the profile value it should read,
for example `p => p.eeo.disabilityStatus`. Reload the extension. One line.

**Add a profile field rather than a literal.** A mapping that returns a bare
`"Yes"` answers that question the same way for everyone who ever installs
this, which is how a tool starts lying on other people's applications. If
there is no sensible profile field, add one to the `screening` block.

## Files

| File | Role |
|---|---|
| `profile.js` | Your data. Ships blank. The only file you edit day to day. |
| `src/dom.js` | DOM helpers: React-safe value setter, waitFor, label lookup, flash. |
| `src/mappings.js` | automation-id table, label alias table, option synonyms. |
| `src/engine.js` | Fill engine: matching, dropdowns, radios, dates, repeating blocks, learning mode. |
| `src/content.js` | Entry point: MutationObserver, shortcuts, badge, resume handoff. |
| `test/` | Regression tests (see below). Uses a fictional persona, never your data. |

## Tests

Run these after every edit to `src/`. They need Node and Python with Playwright
(`pip install playwright && playwright install chromium`).

```
node test/match_test.js                    # every sample label through the real matcher
PROFILE=profile.js node test/match_test.js # the same, against YOUR answers
python3 test/run_all.py                    # headless fill of 3 synthetic Workday pages
```

- `match_test.js` replays fields from a `.jsonl` file (default
  `test/sample_fields.jsonl`, which includes the tricky question wordings
  listed below) through the real matcher with no browser, and prints what each
  one would be filled with. Pass your own log as the first argument.
- `run_all.py` builds each fixture page with the extension inlined, fills it
  twice (the second pass must change nothing it shouldn't) and fails if any
  field comes back unmapped or the page throws.
- Both use `test/sample_profile.js`, a fictional persona. Keep it fictional:
  it ships in the repo.

## Changelog

**2026-10-22: correctness pass.** Every change below was tested against the
fixtures and replayed against a log of 582 real Workday fields, with no change
in any existing answer.

- **Sponsorship questions could be answered from the work-authorization
  value.** The matcher prefers the longest matching phrase, so "authorization
  to work" outranked "require sponsorship" in "Will you require sponsorship to
  obtain authorization to work…?". All authorization phrasings now go through
  one resolver that tells the two questions apart.
- **One-word keys no longer contains-match.** `date` filled Date of Birth and
  Start Date with today; `name` filled Emergency Contact Name. Both now match
  only a field labelled exactly that.
- **Inverted questions are left blank:** "Are you under 18?", "Are you
  willing to obtain a security clearance?", "If you are not a US citizen…?",
  "highest degree earned", and "…in the future be able to work on-site…".
- **Option matching is word-bounded.** "No" can no longer select "None",
  "Not applicable" or "Yes, I will now…", and a short skill like "R" can no
  longer select "Ruby".
- **Checkboxes are tick-only.** A "No" answer leaves a box alone instead of
  unticking something you ticked by hand. The disability checkboxes match
  their answer exactly instead of by substring.
- **Dates:** a calendar never clicks a greyed day from the neighbouring
  month, a month picker never commits a month in the wrong year, and a
  failed attempt closes its popup instead of blocking later fills.
- Radios without a `name` are grouped per question, not page-wide; the
  "currently work here" box is found by its label, not "any checkbox"; and an
  experience section's Add button is never confused with another section's.
- Waits poll on timers instead of `requestAnimationFrame`, which Chrome
  throttles to about 1 frame per second in a background tab.
- The extension now runs only on Workday's application hosts
  (`myworkdayjobs.com`, `myworkdaysite.com`, `myworkday.com`). The old
  `*.workday.com` match also covered Workday's own marketing site, whose
  contact forms it would have filled with your details.
- New blank profile fields: `personal.smsOptIn`,
  `application.willingToTravel`, `application.travelPercentage`,
  `application.reasonForLeaving`, `screening.disciplinaryAction`.
- Also carried over from the private copy: prompt/multiselect widgets
  (search, pick, verify the chip), language rows, empty-section Add buttons,
  education repair, and the technology-list checkbox rule.
