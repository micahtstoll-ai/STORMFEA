# Resolved Issues — Closed via Merged PRs

This document tracks issues that have been resolved through merged pull requests and are now closed.

## How resolution was verified

PR #247 ("integration: consolidated solver-accuracy campaign") is **merged** into
`main` and squash-integrates the code from 30 individually-reviewed PRs
(#206–#245, minus 5 superseded by others in that range). Those 30 PRs each
show as GitHub-`closed`/`merged:false` because their commits were folded into
#247 rather than merged individually — but their code is live on `main`.
Each of those 30 PRs' bodies name the issue(s) it closes via `Fixes #N` /
`Closes #N`, which is how the mapping below was built and verified.

**Exception — #149 stays open.** PR #247 explicitly reverted the #149
(adaptive-refinement) changes after CI caught the sizing field coarsening
instead of refining the mesh under a real TetGen binary. Its fix, PR #246,
remains open and unmerged. #149 was briefly closed in error during this
sweep and has been reopened.

## Issues Closed (68)

### Early solver-accuracy fixes (individually merged)

| Issue | Title | Closed by PR |
|-------|-------|-------------|
| #65 | BLF thresholds documentation & citations | #95 |
| #97 | Verdict SF ignores Hill criterion & calibration | #113 |
| #98 | Parallel assembly never runs (ES module bug) | #126 |
| #101 | Upright orientation tensor rotation & missing G_xy | #116 |
| #108 | CI never exercises real TetGen/Gmsh binaries | #126 |

### 70-issue solver-accuracy campaign, integrated via #247

| Issues | Resolving PR |
|--------|-------------|
| #137 | #206 |
| #143, #144, #145 | #207 |
| #139, #140 | #208 |
| #141, #142, #146, #147, #148 | #209 |
| #164, #138 | #210 |
| #179 | #211 |
| #186 | #212 |
| #136, #153, #154, #155, #160, #161 | #213 |
| #168, #169, #170 | #214 |
| #176, #177, #178 | #215 |
| #158, #159 | #216 |
| #162, #165, #166 | #217 |
| #197, #199, #200, #205, #194 | #219 |
| #198, #201 | #220 |
| #192, #193, #203 | #221 |
| #195 | #222 |
| #188 | #223 |
| #157 | #226 |
| #167, #163 | #229 |
| #150, #156 | #230 |
| #183, #180 | #231 |
| #171 | #232 |
| #172, #173 | #233 |
| #175 | #234 |
| #184 | #235 |
| #182, #185 | #236 |
| #174 | #237 |
| #181 | #238 |
| #187 | #239 |
| #189 | #240 |
| #196 | #241 |
| #202, #204 | #242 |
| #190 | #243 |
| #191 | #244 |
| #151, #152 | #245 |

## Still open

| Issue | Title | Why |
|-------|-------|-----|
| #149 | Close the adaptive-refinement loop | Fix reverted from #247 after failing CI against a real TetGen binary; follow-up PR #246 is unmerged. |

## Summary

- **Total issues closed this sweep**: 68
- **Campaign scope**: 70-issue solver accuracy campaign; 69 of 70 landed on `main`, 1 (#149) deferred
- **Status**: All issues with code actually on `main` are closed; #149 correctly remains open
