// Deterministic resume renderer.
//
// The agent NEVER edits this file per application. It only writes
// applications/<slug>/tailored.yaml, so formatting cannot drift between
// resumes and no single application can quietly restyle itself.
//
// Employer names, job titles, dates, schools, and credential names are
// pulled from data/ by id, which means a tailored file physically cannot
// invent an employer or move a date.
//
// Build through scripts/render.sh, not by calling typst directly:
//   scripts/render.sh applications/<slug>
//
// Look and feel (font, size, paper, margins, color) comes from config.yaml.

#let cfg = yaml("/config.yaml")
#let r = cfg.at("render", default: (:))

#let ink = rgb(r.at("ink", default: "#000000"))
#let accent = rgb(r.at("accent", default: "#000000"))
#let body-font = r.at("font", default: ("Times New Roman", "Liberation Serif", "Times", "DejaVu Serif"))
#let body-size = r.at("font_size", default: 11) * 1pt
// Every other size is a fixed ratio of the body size (calibrated at 11pt),
// so changing font_size in config.yaml moves the whole hierarchy together
// and section headers never end up smaller than body text.
#let sz(pt) = body-size * (pt / 11)

#let d = yaml(sys.inputs.at("data", default: "/applications/_example/tailored.yaml"))
#let profile = yaml("/data/profile.yaml")
#let master-exp = yaml("/data/experience.yaml")
#let master-edu = yaml("/data/education.yaml")
#let master-proj = yaml("/data/projects.yaml")
#let master-certs = yaml("/data/certifications.yaml")
#let master-pubs = yaml("/data/publications.yaml")
#let master-honors = yaml("/data/honors.yaml")

#let find(entries, id) = {
  let hits = entries.filter(e => e.id == id)
  if hits.len() == 0 { panic("id not found in master data: " + id) }
  hits.first()
}

#set page(
  paper: r.at("paper", default: "us-letter"),
  margin: (
    x: r.at("margin_x", default: 0.55) * 1in,
    y: r.at("margin_y", default: 0.45) * 1in,
  ),
)
#set text(font: body-font, size: body-size, fill: ink)
// PACKED SPACING: dense lines read as a confident block and leave room for
// more real content. `leading` is the gap inside a wrapped bullet, list
// spacing the gap between bullets. Do not loosen these to fill a short page:
// add real content instead. The small negative v() offsets under entry
// headers are calibrated to this leading; re-check them if you change it.
#set par(justify: false, leading: 0.32em, spacing: 0.32em)
#set list(spacing: 0.18em, body-indent: 0.5em, marker: text(fill: accent)[•])

// ---------- header ----------
#align(center)[
  #text(size: sz(20), weight: "bold", tracking: 0.02em)[#profile.name]
  #v(1pt)
  #text(size: sz(10), fill: ink)[
    #{
      let parts = ()
      for key in ("location", "phone", "email", "linkedin", "github", "orcid", "website") {
        let val = profile.at(key, default: "")
        if val != "" { parts.push(val) }
      }
      parts.join("  ·  ")
    }
  ]
]

// ---------- helpers ----------
#let section(title, body) = {
  v(5pt)
  text(size: sz(12), weight: "bold", fill: accent, tracking: 0.06em)[#upper(title)]
  v(-1.5pt)
  line(length: 100%, stroke: 0.7pt + accent)
  v(0.5pt)
  body
}

// Authorship roles render BOLD: on a citation they are the first thing a
// reader should catch. Other sub-titles (a degree, a project role) stay
// italic. Add any role you use in data/ that should render bold.
#let AUTHORSHIP-ROLES = ("Sole Author", "First Author", "Co-First Author",
                         "Co-Author", "Senior Author", "Corresponding Author")
#let is-authorship(s) = AUTHORSHIP-ROLES.contains(str(s).trim())

#let entry-header(left-main, left-sub, dates) = {
  grid(
    columns: (1fr, auto),
    column-gutter: 8pt,
    [#text(weight: "bold")[#left-main]#if left-sub != "" [, #if is-authorship(left-sub) [#text(weight: "bold")[#left-sub]] else [#emph(left-sub)]]],
    align(right, text(size: sz(10.4), fill: ink)[#dates]),
  )
}

#let bullets(items) = list(..items.map(b => [#b]))

// ---------- sections ----------
#let render-summary() = {
  let s = d.at("summary", default: "")
  if s == "" { return }
  section("Summary")[#s]
}

#let render-experience() = {
  let items = d.at("experience", default: ())
  if items.len() == 0 { return }
  section("Experience")[
    // Title-first layout: bold job title with dates far right, employer and
    // location on the line below.
    #for (i, item) in items.enumerate() {
      let m = find(master-exp, item.from)
      if i > 0 { v(3pt) }
      entry-header(m.title, "", m.start + " – " + m.end)
      v(-1pt)
      text(size: sz(10.4), fill: ink)[#m.company#if m.at("location", default: "") != "" [, #m.location]]
      bullets(item.bullets)
    }
  ]
}

#let render-projects() = {
  let items = d.at("projects", default: ())
  if items.len() == 0 { return }
  section("Projects")[
    #for (i, item) in items.enumerate() {
      let m = find(master-proj, item.from)
      if i > 0 { v(3pt) }
      let dates = if m.at("start", default: "") == "" { "" } else if m.at("end", default: "") in ("", m.start) { m.start } else { m.start + " – " + m.end }
      entry-header(m.name, m.at("role", default: ""), dates)
      if m.at("link", default: "") != "" {
        v(-1pt)
        text(size: sz(9.6), fill: ink)[#m.link]
      }
      bullets(item.bullets)
    }
  ]
}

#let render-education() = {
  let items = d.at("education", default: ())
  if items.len() == 0 { return }
  section("Education")[
    #for (i, item) in items.enumerate() {
      let id = if type(item) == str { item } else { item.from }
      let m = find(master-edu, id)
      if i > 0 { v(3pt) }
      entry-header(m.school, m.degree + " " + m.at("field", default: ""), m.start + " – " + m.end)
      let extras = ()
      if m.at("gpa", default: "") != "" { extras.push("GPA: " + m.gpa) }
      for h in m.at("honors", default: ()) { extras.push(h) }
      if extras.len() > 0 {
        v(-0.5pt)
        text(size: sz(10.4))[#extras.join("  ·  ")]
      }
      let cw = if type(item) == dictionary { item.at("coursework", default: ()) } else { () }
      if cw.len() > 0 {
        v(-0.5pt)
        text(size: sz(10.4))[#text(weight: "medium")[Coursework:] #cw.join(", ")]
      }
    }
  ]
}

#let render-skills() = {
  let cats = d.at("skills", default: ())
  if cats.len() == 0 { return }
  section("Skills")[
    #for cat in cats {
      block(above: 3pt, below: 1pt)[
        #text(weight: "bold", size: sz(10.8))[#cat.category: ]
        #cat.items.join(", ")
      ]
    }
  ]
}

#let render-publications() = {
  let ids = d.at("publications", default: ())
  if ids.len() == 0 { return }
  section("Publications")[
    #for id in ids {
      let m = find(master-pubs, id)
      block(above: 2.5pt, below: 0pt)[
        #text(size: sz(10.6))[
          #text(weight: "bold")[#m.role]: "#m.title," #emph(m.venue), #m.year#if m.at("status", default: "") != "" [ (#m.status)].#if m.at("link", default: "") != "" [ #text(size: sz(9.6), fill: ink)[#m.link]]
        ]
      ]
    }
  ]
}

#let render-honors() = {
  let ids = d.at("honors", default: ())
  if ids.len() == 0 { return }
  section("Honors & Leadership")[
    #for id in ids {
      let m = find(master-honors, id)
      block(above: 2.5pt, below: 0pt)[
        #text(size: sz(10.6))[
          #text(weight: "medium")[#m.name]#if m.at("year", default: "") != "" [, #m.year]#if m.at("detail", default: "") != "" [: #m.detail]
        ]
      ]
    }
  ]
}

#let render-certifications() = {
  let ids = d.at("certifications", default: ())
  if ids.len() == 0 { return }
  section("Certifications")[
    #{
      let parts = ()
      for id in ids {
        let m = find(master-certs, id)
        let label = m.name
        if m.at("issuer", default: "") != "" { label += " (" + m.issuer }
        if m.at("year", default: "") != "" { label += ", " + m.year }
        if m.at("issuer", default: "") != "" or m.at("year", default: "") != "" { label += ")" }
        parts.push(label)
      }
      parts.join("  ·  ")
    }
  ]
}

// ---------- assemble ----------
// section_order in tailored.yaml decides which sections appear and in what
// order, so a research role can lead with publications and a sales role can
// lead with experience, from the same master data.
#let renderers = (
  summary: render-summary,
  experience: render-experience,
  projects: render-projects,
  publications: render-publications,
  education: render-education,
  skills: render-skills,
  honors: render-honors,
  certifications: render-certifications,
)
#let order = d.at("section_order", default: ("summary", "experience", "projects", "publications", "education", "skills", "honors", "certifications"))
#for s in order {
  (renderers.at(s))()
}
