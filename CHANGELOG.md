# Changelog

All notable changes to STORMFEA are recorded here. The format is loosely based
on Keep a Changelog. Dates are ISO 8601.

## [Unreleased] — Launch prep (T-20 days)

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

### Notes
- Version number for the launch release is still to be decided (currently
  `43.0.0`, shown in-app as `v43`); this entry will be dated and versioned when
  that is set.

Post-launch items remain open: #356, #363, #367, #368, #369, #371.
