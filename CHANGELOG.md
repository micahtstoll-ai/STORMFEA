# Changelog

All notable changes to STORMFEA are recorded here. The format is loosely based
on Keep a Changelog. Dates are ISO 8601.

## [2.0.0] — Launch (unreleased; target ~2026-09-12)

STORMFEA adopts semantic versioning, with MAJOR as the engine generation:
`1.x` original engine, `2.x` this improved engine, `3.x` reserved for generative
design (#327). The version was reset from a drifted `43.0.0` to `2.0.0` to mark
the current engine's first proper release (see CONTRIBUTING.md "Versioning").

Ahead of launch, the UI/UX polish backlog (#356-#371) was triaged into
launch-blockers vs post-launch (tracked in #372, and in ROADMAP.md under
"LAUNCH PREP"). The following launch-blocker fixes landed:

### Fixed
- Bolt/force badges in the viewer's bottom-left were pinned ~42px above the
  bottom (`bottom:54px`); aligned to the same 12px baseline as the legend and
  hint. (#357)
- Layer-height slider caption used a mismatched arrow (a Unicode left-arrow
  glued to an ASCII `->`); replaced with a single bidirectional arrow. (#359)
- Fail-force label ("FAIL FORCE (est., governing mode)") split onto two lines in
  both the sticky results bar and the results card so the metric name reads
  cleanly and the qualifier is clearly secondary. (#360)
- Axis-indicator triad no longer uses a hardcoded green Y axis; all three axis
  colors now come from theme tokens (rust X, neutral Y, gold Z) and adapt to
  light/dark. (#361)
- Workflow rail: the RUN node circle was 8px while step circles were 6px;
  unified to 6px, and the connector line now reaches the RUN node. (#364)
- Delamination "risk by layer" strip: the safe end was rendered green (banned by
  the design palette); the ramp is now gold to amber to red. The worst-layer bar
  no longer paints over other UI while scrolling (removed its `z-index:1`).
  (#370)
- Color palette: a hardcoded green "safe" color in the PDF report export (the
  exact anti-pattern the design palette bans by name), a hardcoded blue and a
  hardcoded purple, ~40 sites using an invalid `var(--token)NN` CSS pattern
  that silently dropped the declaration, and a measured WCAG contrast audit
  (not eyeballed) that found gold text/borders/focus-rings unreadable in light
  theme (~2.3:1 against a 4.5:1/3:1 floor, including the site-wide keyboard
  focus ring), several dark-theme text/border tokens under 4.5:1, and a
  documented "High Contrast" theme that was never actually built. New
  `--gold-text`/`--gold-ink` tokens; several existing tokens re-tuned to clear
  their WCAG floors in both themes. (#388)

### Changed
- Adopted semantic versioning (MAJOR = engine generation); reset the version
  from a drifted `43.0.0` to `2.0.0` across `package.json`, the `/api/health`
  response, and the in-app string. Single-sourcing those three is tracked in
  #373.

Post-launch items remain open: #356, #363, #367, #368, #369, #371.
