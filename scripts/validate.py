#!/usr/bin/env python3
"""Validate a tailored.yaml against the master data in data/.

This is the anti-hallucination gate. Every claim that reaches a rendered
resume must trace back to something you actually wrote in data/. An AI
agent can select, reorder, and rephrase your master data; it cannot
invent an employer, inflate a number, or list a skill you never claimed.

Checks (ERRORS block rendering; warnings do not):
  - meta.company / meta.role / meta.role_short present            [error]
  - every experience/project/education `from` id exists in data/  [error]
  - every publication / honor / certification id exists           [error]
  - numbers in bullets appear in the referenced master entry, so
    a 96% can never quietly become 120%                           [error]
  - numbers in the summary appear somewhere in master data        [error]
  - every skill listed exists in data/skills.yaml                 [error]
  - sample-* ids or FILL_ME profile fields in a real resume       [error]
  - no em dashes anywhere that renders     [error, config-gated]
  - every dated section is reverse chronological
                                           [error, config-gated]
  - more than rules.max_bullets bullets total                     [warning]

Usage: python3 scripts/validate.py applications/<slug>/tailored.yaml
       RESUME_ALLOW_SAMPLE=1 (or --allow-sample) downgrades the
       sample/FILL_ME errors to warnings, so you can smoke-test the
       pipeline with the shipped example before entering your own data.

Rules are toggled in config.yaml.
"""
import os
import re
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOW_SAMPLE = os.environ.get("RESUME_ALLOW_SAMPLE") == "1" or "--allow-sample" in sys.argv

errors = []
warnings = []

DEFAULT_RULES = {
    "no_em_dash": True,
    "reverse_chronological": True,
    "max_bullets": 18,
    "max_pages": 1,
}


def load_config():
    path = os.path.join(ROOT, "config.yaml")
    cfg = {}
    if os.path.exists(path):
        with open(path) as f:
            cfg = yaml.safe_load(f) or {}
    rules = dict(DEFAULT_RULES)
    rules.update((cfg.get("rules") or {}))
    return rules


RULES = load_config()


def load(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return yaml.safe_load(f) or []


def flatten(obj):
    """Serialize an entry to one searchable string."""
    if isinstance(obj, dict):
        return " ".join(flatten(v) for v in obj.values())
    if isinstance(obj, list):
        return " ".join(flatten(v) for v in obj)
    return str(obj)


NUM_RE = re.compile(r"\$?\d[\d,]*(?:\.\d+)?%?|\$\d[\d,]*(?:\.\d+)?[kKmMbB]\b")

EM_DASH = "—"

MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"])}


def date_key(value, default_month):
    """'Jun 2025' / '2025' / 'May 2027 (expected)' / 'Present' -> sortable tuple.
    Returns None when no date can be parsed (undated entries are exempt)."""
    s = str(value or "").strip().lower()
    if not s:
        return None
    if "present" in s or "current" in s or "ongoing" in s:
        return (9999, 12)
    m = re.search(r"(19|20)\d{2}", s)
    if not m:
        return None
    month = default_month
    for name, num in MONTHS.items():
        if name in s:
            month = num
            break
    return (int(m.group(0)), month)


def check_reverse_chrono(name, items, master, id_key="from"):
    if not RULES.get("reverse_chronological", True):
        return
    keyed = []
    for item in items or []:
        ref = item if isinstance(item, str) else (item or {}).get(id_key)
        entry = master.get(ref)
        if not entry:
            continue  # unknown ids already error elsewhere
        end = date_key(entry.get("end") or entry.get("year"), 12)
        start = date_key(entry.get("start") or entry.get("year"), 1)
        if end is None and start is None:
            continue  # undated entry (e.g. an honor with no year) is exempt
        keyed.append((ref, (end or start, start or end)))
    for (r1, k1), (r2, k2) in zip(keyed, keyed[1:]):
        if k2 > k1:
            errors.append(
                f"{name}: '{r2}' is more recent than '{r1}' but is listed after "
                "it. Every dated section must be reverse chronological: ongoing "
                "entries first (newest start first), then by end date, ties "
                "broken by start date. Disable with rules.reverse_chronological "
                "in config.yaml."
            )


def check_no_emdash(text, where):
    if not RULES.get("no_em_dash", True):
        return
    if EM_DASH in str(text):
        errors.append(
            f"{where}: contains an em dash (U+2014), which this repo bans on "
            "resumes. Rewrite with a comma, colon, semicolon, or parentheses. "
            "Disable with rules.no_em_dash in config.yaml."
        )


def check_numbers(text, source_text, where):
    src = source_text.replace(",", "").lower()
    for tok in NUM_RE.findall(text):
        norm = tok.replace(",", "").strip("$%").lower()
        if norm and norm not in src:
            msg = (f"{where}: '{tok}' does not appear in the referenced master "
                   "entry. Metrics must come from data/ verbatim.")
        else:
            continue
        if len(norm) == 1:  # bare single digit, e.g. "3 clients" vs "three"
            warnings.append(msg)
        else:
            errors.append(msg)


def norm_skill(s):
    return re.sub(r"\s+", " ", str(s).strip().lower())


# Skill matching is whole-token, in both directions, so "Pandas" satisfies a
# master entry of "Pandas" and "AWS Lambda" satisfies "AWS", while "NoSQL"
# does NOT sneak through on a master entry of "SQL". Names shorter than 3
# characters (R, C, Go) must match exactly, otherwise a one-letter master
# skill would match almost anything.
SKILL_EDGE = r"[a-z0-9+#.]"


def skill_known(item, master_skills):
    low = norm_skill(item)
    if not low:
        return True
    if low in master_skills:
        return True
    for ms in master_skills:
        if len(ms) < 3 or len(low) < 3:
            continue  # short names are exact-match only
        if re.search(rf"(?<!{SKILL_EDGE}){re.escape(ms)}(?!{SKILL_EDGE})", low):
            return True
        if re.search(rf"(?<!{SKILL_EDGE}){re.escape(low)}(?!{SKILL_EDGE})", ms):
            return True
    return False


def sample_flag(msg):
    (warnings if ALLOW_SAMPLE else errors).append(msg)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print("usage: validate.py <path/to/tailored.yaml>")
        sys.exit(1)
    path = args[0]
    with open(path) as f:
        t = yaml.safe_load(f)
    if not isinstance(t, dict):
        print("ERROR: tailored.yaml is empty or not a mapping")
        sys.exit(1)

    profile = load("data/profile.yaml")
    exp = load("data/experience.yaml")
    edu = load("data/education.yaml")
    proj = load("data/projects.yaml")
    certs = load("data/certifications.yaml")
    skills = load("data/skills.yaml")
    pubs = load("data/publications.yaml")
    honors = load("data/honors.yaml")

    exp_by_id = {e["id"]: e for e in exp}
    edu_by_id = {e["id"]: e for e in edu}
    proj_by_id = {e["id"]: e for e in proj}
    cert_ids = {c["id"] for c in certs}
    pub_ids = {p["id"] for p in pubs}
    honor_ids = {h["id"] for h in honors}
    all_master_text = flatten([exp, edu, proj, certs, skills, pubs, honors])

    # meta
    meta = t.get("meta") or {}
    for key in ("company", "role", "role_short"):
        if not meta.get(key):
            errors.append(f"meta.{key} is missing, and it is needed for the PDF filename")
        else:
            check_no_emdash(meta[key], f"meta.{key}")

    # profile values render in the header on every resume
    for k, v in (profile or {}).items():
        check_no_emdash(v, f"data/profile.yaml '{k}'")

    # profile completeness
    if "FILL_ME" in flatten(profile):
        sample_flag(
            "data/profile.yaml still contains FILL_ME placeholders. Fill in your "
            "real contact details before rendering a resume you will actually send."
        )

    total_bullets = 0

    def check_ref_section(name, items, master, id_key="from"):
        nonlocal total_bullets
        for i, item in enumerate(items):
            ref = item if isinstance(item, str) else item.get(id_key)
            where = f"{name}[{i}]"
            if not ref:
                errors.append(f"{where}: missing '{id_key}'. Every entry must reference a master data id.")
                continue
            if str(ref).startswith("sample-"):
                sample_flag(
                    f"{where}: references shipped sample data id '{ref}'. Replace "
                    "the sample entries in data/ with your own before sending this."
                )
            if ref not in master:
                errors.append(f"{where}: unknown id '{ref}', not found in master data")
                continue
            # entry headers render these master fields verbatim
            for f in ("company", "title", "location", "name", "role", "school", "degree", "field", "gpa"):
                check_no_emdash(master[ref].get(f, ""), f"{where} master field '{f}'")
            for h in master[ref].get("honors") or []:
                check_no_emdash(h, f"{where} master honors line")
            if isinstance(item, dict):
                bl = item.get("bullets") or []
                if name in ("experience", "projects") and not bl:
                    warnings.append(f"{where}: has no bullets")
                total_bullets += len(bl)
                src = flatten(master[ref])
                for j, b in enumerate(bl):
                    check_numbers(str(b), src, f"{where}.bullets[{j}]")
                    check_no_emdash(str(b), f"{where}.bullets[{j}]")
                for j, c in enumerate(item.get("coursework") or []):
                    check_no_emdash(c, f"{where}.coursework[{j}]")

    check_ref_section("experience", t.get("experience") or [], exp_by_id)
    check_ref_section("projects", t.get("projects") or [], proj_by_id)
    check_ref_section("education", t.get("education") or [], edu_by_id)

    check_reverse_chrono("experience", t.get("experience"), exp_by_id)
    check_reverse_chrono("projects", t.get("projects"), proj_by_id)
    check_reverse_chrono("education", t.get("education"), edu_by_id)
    check_reverse_chrono("publications", t.get("publications"), {p["id"]: p for p in pubs})
    check_reverse_chrono("certifications", t.get("certifications"), {c["id"]: c for c in certs})
    check_reverse_chrono("honors", t.get("honors"), {h["id"]: h for h in honors})

    # id-list sections render their master entries verbatim, so those master
    # fields are also subject to the em-dash ban.
    verbatim_by_id = {
        "certifications": ({c["id"]: c for c in certs}, ("name", "issuer", "year")),
        "publications": ({p["id"]: p for p in pubs}, ("authors", "role", "title", "venue", "year", "status", "link")),
        "honors": ({h["id"]: h for h in honors}, ("name", "org", "year", "detail")),
    }
    for name, ids in (("certifications", cert_ids), ("publications", pub_ids), ("honors", honor_ids)):
        for i, ref in enumerate(t.get(name) or []):
            if str(ref).startswith("sample-"):
                sample_flag(f"{name}[{i}]: references shipped sample data id '{ref}'")
            if ref not in ids:
                errors.append(f"{name}[{i}]: unknown id '{ref}'")
                continue
            by_id, fields = verbatim_by_id[name]
            for f in fields:
                check_no_emdash(by_id[ref].get(f, ""), f"{name} '{ref}' master field '{f}'")

    # summary numbers must exist SOMEWHERE in master data
    if t.get("summary"):
        check_numbers(str(t["summary"]), all_master_text, "summary")
        check_no_emdash(str(t["summary"]), "summary")

    # skills lines render verbatim
    for i, cat in enumerate(t.get("skills") or []):
        check_no_emdash(cat.get("category", ""), f"skills[{i}].category")
        for item in cat.get("items", []):
            check_no_emdash(item, f"skills[{i}] '{item}'")

    # skills must exist in the master inventory
    master_skills = [norm_skill(s) for cat in skills for s in cat.get("items", [])]
    for i, cat in enumerate(t.get("skills") or []):
        for item in cat.get("items", []):
            if not skill_known(item, master_skills):
                errors.append(
                    f"skills[{i}] '{item}': not in data/skills.yaml. Add it there "
                    "first if you really have it."
                )

    max_bullets = RULES.get("max_bullets", 18)
    if max_bullets and total_bullets > max_bullets:
        warnings.append(
            f"{total_bullets} bullets total, which likely spills past one page. "
            "Trim to the most relevant."
        )

    for w in warnings:
        print(f"WARNING: {w}")
    for e in errors:
        print(f"ERROR: {e}")
    if errors:
        print(f"\nFAILED: {len(errors)} error(s). Fix tailored.yaml, or add the missing facts to data/ if they are real.")
        sys.exit(1)
    print(f"OK: {path} validates against master data ({len(warnings)} warning(s))")


if __name__ == "__main__":
    main()
