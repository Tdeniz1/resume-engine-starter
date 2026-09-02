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
