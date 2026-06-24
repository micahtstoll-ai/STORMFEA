# Start Design Loop

Register the nightly 3am design research cron for this session.
Run this at the start of any new Claude Code session to keep the automation running.

## Instructions

Call CronCreate with these exact parameters:
- cron: `13 3 * * *`
- recurring: true
- durable: true
- prompt: the full agent prompt below

Then confirm to the user that the cron is registered and will fire at 3:13am nightly.

## Cron Prompt (pass verbatim as the `prompt` parameter)

You are the STORMFEA daily design research and improvement agent. Work through every step below without stopping. The working directory is /home/user/STORMFEA.

---

STEP 1 — READ DESIGN RULES
Read /home/user/STORMFEA/DESIGN.md so you know what is and isn't allowed.

STEP 2 — RESEARCH (run all four in parallel)
a. WebSearch: "Claude Code design skill UI 2025 technique"
b. WebSearch: "anti-slop engineering UI design system"
c. WebFetch: https://docs.anthropic.com/en/docs/claude-code/overview
d. WebFetch: https://claude.com/blog

STEP 3 — READ PRIOR FINDINGS
Read /home/user/STORMFEA/DESIGN_RESEARCH.md to avoid duplicating what is already there.

STEP 4 — SYNTHESIZE AND APPEND
Write a digest entry in this format and append it to DESIGN_RESEARCH.md:

## Design Research — [TODAY'S DATE]

### New Finds
[bullets of genuinely new things found — videos, docs updates, GitHub tools. If nothing new, write "Nothing new today."]

### Actionable for STORMFEA
[1–3 SPECIFIC CSS changes not yet in the file: selector, property, current value → new value, and which DESIGN.md rule it satisfies. If none, write "No new actions."]

---

STEP 5 — IMPLEMENT ONE IMPROVEMENT
a. Read /home/user/STORMFEA/client/index.html lines 150–500 (the CSS section).
b. Check the existing DESIGN_RESEARCH.md for any previously listed actionable items that have NOT been implemented yet.
c. Pick the single safest improvement — either from today's research or the backlog. Safe means: changing a CSS token value, fixing letter-spacing, removing a hardcoded px that should use a variable, correcting a border-radius that violates DESIGN.md. NOT changing layout structure, display types, or JavaScript.
d. Apply the change using the Edit tool.
e. Run in Bash: cd /home/user/STORMFEA && npm run copy:client

STEP 6 — COMMIT AND PUSH
Run in Bash:
  cd /home/user/STORMFEA
  git add DESIGN_RESEARCH.md client/index.html dist/
  git diff --staged --quiet || git commit -m "design: daily update $(date +%Y-%m-%d)"
  git push origin claude/modest-pascal-5pj0zq

If step 5 found nothing safe to change, skip 5c–5d and only commit the DESIGN_RESEARCH.md update.
