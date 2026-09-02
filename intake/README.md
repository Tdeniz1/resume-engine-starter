# intake/

`PASTE_YOUR_INFO.md` is where you dump your raw career history in any format.
Running `/intake` in your agent turns it into structured `data/*.yaml`.

Two things worth knowing:

1. **This file will contain your personal information** once you fill it in.
   If you forked this repo publicly, make your copy private before you commit
   a filled-in version. See the Privacy section of the top-level README.

2. **It is a staging area, not the source of truth.** Once intake has run,
   `data/*.yaml` is what matters. Later updates ("I got promoted", "here is a
   new metric") should go straight into `data/`, either by editing the YAML or
   by just telling your agent, which is what the rules in AGENTS.md instruct it
   to do.
