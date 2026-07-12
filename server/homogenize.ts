/**
 * homogenize.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Numerical homogenization of the infill core — code that PRODUCES the lattice
 * stiffness-degradation exponent instead of picking one within a range.
 *
 * THE PROBLEM
 * -----------
 * The Gibson-Ashby power law E_core(ρ) = E_solid · ρ^n has a CITED form
 * (Gibson & Ashby 1997) but the exponent n for a specific FDM wall-network
 * pattern is not reported by any paper. STORMFEA therefore picks n WITHIN the
 * cited open-cell range [1.5, 2.5] as an engineering estimate — confidence LOW
 * (server/solver/lattice.ts). That is a guess inside a range, with no
 * independent check.
 *
 * THE METHOD
 * ----------
 * A wall-network (walls25d) infill is, to first order, a solid sheet perforated
 * by a periodic array of voids. We already build exactly that geometry for the
 * Kirsch benchmark — buildPlateWithHoleMesh (coupon_fea.ts) meshes a plate with
 * a central circular through-hole. Sweeping the hole radius sweeps the relative
 * density ρ = 1 − (void area / cell area). Running each cell through the SAME
 * production solver that evaluates real parts (runLinearStatic) under uniaxial
 * tension and reading the apparent (gross-section) modulus gives an effective
 * degradation curve g(ρ) = E_eff(ρ)/E_solid computed FROM the solver, not
 * assumed. A log-log fit through the origin recovers the exponent:
 *
 *     n = Σ(ln ρ · ln g) / Σ(ln ρ)²        (forcing g = ρ^n)
 *
 * This reuses runLinearStatic and buildPlateWithHoleMesh deliberately — the
 * homogenization and the part prediction share one stress engine, exactly as
 * coupon_fea.ts shares it for calibration Kt.
 *
 * SCOPE / HONESTY
 * ---------------
 * This is a single-hole perforated-plate cell, not a fully periodic RVE, so it
 * is a first-order estimate — good enough to CORROBORATE that the in-use
 * walls25d exponent lies in the Gibson-Ashby regime (raising its confidence
 * from LOW to MEDIUM), not to replace physical coupon calibration (the path to
 * HIGH). The 3-D TPMS (tpms3d/gyroid) families need an implicit-surface RVE and
 * are intentionally NOT homogenized here — they stay LOW.
 */

import type { AnyMaterial, TetMesh } from "./solver/types.js";
import { runLinearStatic } from "./solver/pipeline.js";
import {
  buildGaugeBoxMesh,
  buildPlateWithHoleMesh,
  buildAxialConstraintsAndForces,
  type Axis,
} from "./coupon_fea.js";

/** Reference tension load (N). Linear solver ⇒ modulus is load-independent. */
const REF_FORCE_N = 1000;

/**
 * Apparent (gross-section) axial Young's modulus of a cell under uniaxial
 * tension along `axis`, measured the way homogenization requires:
 *
 *   σ_apparent = F / A_gross          (A_gross = full cell cross-section)
 *   ε_apparent = δ̄_loaded / L         (δ̄ = mean axial displ. of the loaded face)
 *   E_eff      = σ_apparent / ε_apparent
 *
 * A_gross uses the FULL cell footprint (voids included), so a perforated cell
 * reports a reduced modulus — that reduction IS the homogenized degradation.
 */
export async function axialEffectiveModulus(
  mesh: TetMesh,
  material: AnyMaterial,
  axis: Axis,
  grossAreaMm2: number,
): Promise<number> {
  const { constraints, forces, loMin, loMax } =
    buildAxialConstraintsAndForces(mesh, axis, REF_FORCE_N);

  const result = await runLinearStatic({ mesh, material, constraints, forces });
  const L = loMax - loMin || 1;

  // Mean axial displacement over the loaded (high-coordinate) face nodes.
  let sum = 0;
  let count = 0;
  for (const f of forces) {
    sum += result.displacement[f.nodeIndex * 3 + axis] ?? 0;
    count++;
  }
  const deltaAvg = count > 0 ? sum / count : 0;
  const strain = deltaAvg / L;
  const stress = REF_FORCE_N / grossAreaMm2;
  return strain > 1e-12 ? stress / strain : 0;
}

export interface HomogenizationSample {
  /** Relative density ρ ∈ (0,1] of the perforated cell. */
  rho: number;
  /** Homogenized stiffness scale g = E_eff/E_solid at this density. */
  gStiff: number;
}

export interface HomogenizationResult {
  /** Solid-cell modulus measured with the same method (normalizer). */
  eSolidMeasuredMPa: number;
  samples: HomogenizationSample[];
  /** Least-squares power-law exponent n such that g ≈ ρ^n. */
  fittedExponent: number;
  /** RMS residual of the fit in log space (fit quality diagnostic). */
  logRmsResidual: number;
}

/**
 * Homogenize a square perforated-plate (walls25d) cell: sweep the void radius,
 * solve each cell, and fit the stiffness exponent. `cellMm` is the in-plane
 * cell side (square: width = length), `thickMm` the out-of-plane thickness.
 *
 * `holeFractions` are void-radius/half-cell ratios; each maps to a relative
 * density ρ = 1 − π·(r/cell)². Defaults span a practical infill band.
 */
export async function homogenizePerforatedPlate(opts: {
  material: AnyMaterial;
  cellMm?: number;
  thickMm?: number;
  divPerMmInv?: number;
  holeFractions?: number[];
}): Promise<HomogenizationResult> {
  const cell = opts.cellMm ?? 20;
  const thick = opts.thickMm ?? 3;
  // r/(cell/2) ratios → hole radii; kept ≤ 0.9 so ligaments stay meshable.
  const fractions = opts.holeFractions ?? [0.3, 0.45, 0.6, 0.75, 0.85];
  const axis: Axis = 2; // load along z (the plate length)
  const grossArea = cell * thick;

  // Solid reference measured with the SAME axial method so the method's
  // clamp/discretization bias cancels in the ratio g = E_eff/E_solid.
  const solidMesh = buildGaugeBoxMesh(cell, thick, cell, opts.divPerMmInv);
  const eSolid = await axialEffectiveModulus(solidMesh, opts.material, axis, grossArea);

  const samples: HomogenizationSample[] = [];
  for (const frac of fractions) {
    const r = (frac * cell) / 2;
    const rho = 1 - (Math.PI * r * r) / (cell * cell);
    const mesh = buildPlateWithHoleMesh({
      widthMm: cell, thickMm: thick, lengthMm: cell, holeR: r,
    });
    const eEff = await axialEffectiveModulus(mesh, opts.material, axis, grossArea);
    samples.push({ rho, gStiff: eEff / eSolid });
  }

  // Least-squares fit of g = ρ^n through the origin in log space:
  //   n = Σ(ln ρ · ln g) / Σ(ln ρ)².
  let num = 0, den = 0;
  for (const s of samples) {
    const lr = Math.log(s.rho);
    const lg = Math.log(Math.max(s.gStiff, 1e-9));
    num += lr * lg;
    den += lr * lr;
  }
  const n = den > 0 ? num / den : 0;

  let sq = 0;
  for (const s of samples) {
    const predicted = n * Math.log(s.rho);
    const actual = Math.log(Math.max(s.gStiff, 1e-9));
    sq += (predicted - actual) ** 2;
  }
  const logRms = Math.sqrt(sq / Math.max(1, samples.length));

  return {
    eSolidMeasuredMPa: eSolid,
    samples,
    fittedExponent: n,
    logRmsResidual: logRms,
  };
}
