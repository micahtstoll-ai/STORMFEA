# Research Design Improvements

Search YouTube, Anthropic documentation, and GitHub for actionable UI/UX improvements relevant to STORMFEA and Claude Code design quality. Surface findings as a structured digest.

## Context

STORMFEA is a single-file vanilla JS FEA application built by Nordic Storm FTC 5962. Its design system (see `/DESIGN.md`) uses Rajdhani/Outfit/DM Mono fonts, a gold-on-dark palette, and instrument-panel aesthetics. The ongoing concern is avoiding "AI slop" — generic AI-generated UI patterns.

## Instructions

Run all three searches in parallel, then synthesize.

### 1. YouTube (WebSearch)

Search for recent videos on these topics:
- `"Claude Code" design skill UI 2025`
- `anti-slop UI design AI`
- `Claude Code frontend beautiful design`
- `design system engineering tool UI`

For each relevant video found: note the title, channel, rough date, and one-sentence summary of what design technique it covers.

### 2. Anthropic Documentation (WebFetch)

Fetch and scan these pages for anything new relevant to UI quality or agent design capabilities:
- `https://docs.anthropic.com/en/docs/claude-code/overview`
- `https://claude.com/blog`
- `https://docs.anthropic.com/en/docs/agents-and-tools/mcp`

Note any new features, tools, or MCP servers that could improve design workflow (e.g. screenshot tools, browser automation, design MCP servers).

### 3. GitHub (WebSearch)

Search for:
- `site:github.com claude-code design skill`
- `site:github.com "anti-slop" UI`
- `site:github.com claude code design system`

Look for new skills, plugins, or repos that add design capabilities to Claude Code.

## Output Format

Present findings as a markdown digest with three sections:

```
## Design Research — [DATE]

### Videos & Tutorials
- [Title] (Channel, ~date): One-sentence technique summary.

### Anthropic / Claude Code Updates
- [Feature or doc section]: Why it matters for design work.

### GitHub Finds
- [Repo or skill]: What it adds and link.

### Actionable for STORMFEA
- Bullet list of specific changes worth making based on above findings.
```

If this skill was invoked via cron (not manually), append the digest to `/home/user/STORMFEA/DESIGN_RESEARCH.md` with a `---` separator. If invoked manually in chat, print the digest to the conversation only.
