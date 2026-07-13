# Layer-Model Audit — Findings & Decisions

**Scope:** how STORMFEA accounts for FDM layers: the transversely isotropic
constitutive model, the Hill (1948) failure criterion, the print-setting
multipliers, and the calibration pipeline that feeds them.
**Status:** A4 is fixed in this audit's companion commit. A1–A3 and A5 are
fixed by the decoupled dual criterion and A6 by the bead-penetration bond
model — both later commits on this branch (`server/solver/stress.ts`,
`server/solver/bond.ts`); until those land, the sections below describe the
defects in the present tense of the code they audit.

---

## Background: the model under audit

Layers are homogenized — the mesh has no layer boundaries. The part is a
transversely isotropic continuum whose weak direction is the layer normal
(`weakAxis`, from the picked bed face; exact 6×6 Bond rotation of C), with:

- stiffness ratios `E_z/E_xy = 0.65`, `G_xz/G_xy = 0.40` (literature),
- strength `yieldZ = 0.58 × yieldXY × layerHeightFactor`,
- failure by the Hill (1948) quadratic with coefficients built from
  `Y = yieldXY` and `Z = yieldZ`:
  `F = G = 1/(2Z²)`, `H = 1/Y² − 1/(2Z²)`, `N = 3/(2Y²)`, `L = M = 3/(2Z²)`,
- print-setting scalars: infill (linear 0.30→1.0), wall bonus (+0.10 each),
  pattern multipliers, orientation multiplier (flat 0.55 / angled 0.75 /
  upright 0.90), layer-height factor (±15 % linear).

---

## A1 — The "transversely isotropic" Hill criterion was azimuth-dependent in the layer plane

**Defect.** Rotational symmetry about the layer normal requires `N = F + 2H`.
The implementation set `N = 3/(2Y²)` independently; that only equals `F + 2H`
when `Z = Y` (the von Mises collapse the validation suite checks). At
`Z = 0.58 Y`:

- `N = 1.50/Y²` but `F + 2H = 2/Y² − 1/(2Z²) = 0.51/Y²`.
- The same physical in-plane pure-shear state yields at `τ = Y/√3 ≈ 0.577 Y`
  when expressed as `τxy`, but at `τ ≈ 0.99 Y` when the part (or load) is
  rotated 45° about the build axis so the state appears as `(σ, −σ)` —
  a **1.7× safety-factor swing for the identical physical problem** depending
  on the part's azimuth on the build plate.

**Underlying impossibility.** A quadratic Hill form cannot simultaneously
satisfy (i) in-plane isotropy, (ii) uniaxial in-plane yield `Y`, (iii)
in-plane shear yield `Y/√3`, and (iv) through-thickness yield `Z ≠ Y`.
Enforcing `N = F + 2H` at `Z = 0.58 Y` would force the in-plane shear yield
to ≈ `0.99 Y` — far above any measured polymer shear strength. Picking better
constants cannot fix this; the criterion had to be restructured.

**Fix.** The dual criterion: bulk von Mises (azimuth-invariant by
construction) governs the bead material; a separate interface criterion
governs the layer bond. Locked by an azimuth-invariance regression test.

## A2 — The "conservative" uncertainty band could silently report SF = 999

**Defect.** For `Z < Y/2` the in-plane principal-shear coefficient
`F + G + 4H = 4/Y² − 1/Z²` goes negative. `hillEquivalentStress` clamps the
quadratic form at zero (`Math.max(0, 2f)`), so in-plane tension–compression
states of **any magnitude** returned `σ_eq = 0` → SF = 999. The conservative
uncertainty-band bound `yieldZ/yieldXY = 0.48` is below 0.5, so the
"conservative" band could be *unconservative* for exactly those states.

**Fix.** The dual criterion's bulk term is a norm — it cannot go negative.
The band evaluation now scales interface allowables only.

## A3 — Interlayer failure was tension/compression symmetric

**Defect.** Hill is quadratic (sign-blind) and the `U_Z` heatmap used
`|σzz|`: compressive through-layer stress counted toward bond failure exactly
like tension. Physically, layers do not delaminate in compression;
compression *increases* interlayer shear capacity (friction).

**Fix.** The interface criterion uses the Macaulay bracket `⟨σzz⟩₊` for the
tension term and a Mohr–Coulomb friction enhancement of shear capacity under
compression. Compressive crushing is still caught by the bulk von Mises term.

## A4 — The orientation multiplier double-counted the layer penalty

**Defect.** `effectiveStrengthMultiplier` scaled the solved material's
`yieldXY` by the orientation multiplier (flat **0.55×**), and the Hill
criterion then applied the through-layer penalty (`yieldZ = 0.58 × yieldXY`)
on top. The 0.55 flat multiplier (Rodriguez et al. 2001: strength of coupons
loaded *across* layers) encodes the **same physics** as the 0.58 ratio. Net
effect of the stack:

- a flat part's **in-plane** strength — which *is* the coupon-measured
  `yieldXY`; tensile coupons are printed flat and pulled in-plane — was
  knocked to 0.55× for no physical reason, and
- its **through-layer** strength became `0.55 × 0.58 ≈ 0.32 ×` base instead
  of the measured `0.58 ×`.

The multiplier predates the weakAxis tensor model, which now resolves
load-vs-layer direction exactly.

**Fix (this commit).**
- `materialStrengthMultiplier(infill, walls, pattern)` — orientation-free —
  feeds the solved material and `effectiveYield`. Stiffness saturation
  changed from `min(1, mul/0.55)` to `min(1, mul)` (identical numerics once
  the 0.55 left the multiplier).
- `effectiveStrengthMultiplier` (with orientation) survives **only** as the
  quick scalar estimator for recommendations / what-if ranking.
- Two-region shell and the core's solid base build at `mul = 1.0` — exactly
  the convention the coupon calibration back-calculates.
- **The one retained orientation scalar:** an *angled print with no bed
  picked* has no directional model at all (the material would be analysed in
  the flat frame), so the legacy 0.75 stays as a conservative fallback there
  (`angledNoBedFallbackMul`). Flat is the exact natural frame; upright-no-bed
  is handled by the conservative scalar swap; any picked bed face gets the
  exact tensor rotation.

**Result shift (disclosed):** flat-printed parts governed by through-layer
stress gain ≈ 1.8× SF (the double-count removed); flat parts loaded in-plane
gain the same factor. Upright parts (no bed) keep the swap semantics with the
0.90 scalar removed (≈ 1.1× SF). Parts with a picked bed face lose only the
scalar (criterion unchanged in Phase A).

## A5 — Lap-shear calibration couldn't disagree with the Hill coupling

**Defect.** `backCalculateProfile` converted the measured interlaminar shear
strength into `yieldZ = τ/0.58` — baking Hill's `τ_z = Z/√3` assumption into
the *measurement*. A bond that is strong in shear but weak in tension (or
vice versa) was unrepresentable, no matter what was measured.

**Fix.** The lap-shear coupon now calibrates an independent interlaminar
shear allowable (`interShear_MPa` → `yieldZShear`); the new upright Z-tension
coupon measures `yieldZ` directly. The legacy `τ/0.58` derivation remains
only as a flagged fallback when no Z-tension measurement exists.

## A6 — Bead penetration was entirely absent

**Defect.** Layer height was the only process input to bond strength
(`layerHeightFactor`, ±15 % linear). Nozzle temperature, print speed,
extrusion width and cooling — the parameters that physically create the bond
(interface temperature history → wetting/neck growth → molecular healing) —
had no model.

**Fix.** `server/solver/bond.ts`: an anchored physics model (lumped-capacitance
interface cooling → Frenkel/Pokluda neck growth → reptation healing) predicts
`S_zt`, `S_zs`, and `E_z` ratios from process settings, normalized so the
reference condition reproduces the literature anchors (0.58 / 0.58·√3⁻¹ /
0.65). Coefficients are LOW-confidence literature values until fitted from
printer process sweeps (`POST /api/calibration/bond-sweep`). When no process
settings are provided the legacy layer-height factor path is used unchanged.

---

## Verified-unchanged items

- **Bond rotation** (`rotateC6`, `rotationAligningZTo`): exact, validated in
  `bond-rotation.test.ts`; flat (+Z) is the identity. Unchanged.
- **`layerHeightFactor` direction and clamp** (±15 %, Farashi & Vafaee 2022):
  retained as the fallback when no process settings are present.
- **Two-region invariants** (CLAUDE.md #1–#8): blend structure untouched;
  the field gains a `yieldZShear` array following the same per-bin pattern.
- **`E_z/E_xy = 0.65`, `G_xz/G_xy = 0.40`, `ν_xz = 0.30`**: literature values
  retained (calibration/bond-model can override the first).
