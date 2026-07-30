/**
 * bond.ts
 * -------
 * Bead-penetration / interlayer bond-formation model (layer-model audit A6).
 *
 * Predicts how PROCESS settings — nozzle temperature, print speed, part-
 * cooling fan, bed/ambient temperature — change the interlayer bond relative
 * to the reference condition, from the physics that actually forms the bond:
 *
 *   1. INTERFACE TEMPERATURE HISTORY — the freshly deposited road cools by
 *      convection (lumped capacitance):  T(t) = T_env + (T0 − T_env)·e^(−t/τc)
 *      with τc = ρ·c_p·A_c/(h·P_c) ≈ ρ·c_p·π·h_L/(8·h_eff) for an elliptical
 *      road of height h_L, and h_eff rising with the part-cooling fan.
 *      The interface's starting temperature T0 mixes the hot incoming bead
 *      with the substrate road, which has cooled for one inter-pass time
 *      t_pass ≈ L_pass / printSpeed — this is how SPEED enters: faster
 *      printing returns to the neighbouring road sooner, landing on a hotter
 *      substrate (Coogan & Kazmer 2017 measured exactly this trend).
 *
 *   2. BOND POTENTIAL Φ — the healing/neck-growth processes are thermally
 *      activated, so their progress is the time integral of an Arrhenius
 *      factor along the cooling curve while the interface stays above Tg:
 *        Φ = ∫ exp(−E_a/R·(1/T(t) − 1/T_ref)) dt,   T(t) > Tg + 5 °C
 *      (Yang & Pitchumani 2002 healing model; Bellehumeur et al. 2004 /
 *      Pokluda et al. 1997 Newtonian sintering — both reduce to an
 *      Arrhenius-weighted time integral for a prescribed T(t)).
 *
 *   3. STRENGTH / STIFFNESS SCALING — early-stage Frenkel neck growth gives
 *      neck ratio θ ∝ Φ^(1/2); reptation healing gives D_h ∝ Φ^(1/4); bond
 *      strength ∝ θ·D_h ∝ Φ^(3/4), bond stiffness ∝ contact ∝ Φ^(1/2)·…
 *      We use  relStrength = (Φ/Φ_ref)^(3/4),  relStiffness = √relStrength.
 *
 * ANCHORING (the load-bearing design decision): the model returns multipliers
 * RELATIVE to the reference process condition (per-material reference nozzle
 * temperature, 60 mm/s, fan 100 %, bed 60 °C, ambient 25 °C), evaluated at
 * the SAME layer height and extrusion width as the current settings. So:
 *   - at the reference condition the multipliers are exactly 1.0, and every
 *     legacy result (which assumed "typical" process settings) is unchanged;
 *   - the layer-height direction stays governed by the separately validated
 *     empirical layerHeightFactor (Farashi & Vafaee 2022 meta-analysis) —
 *     this model multiplies ON TOP of it and captures the hL–process
 *     interaction only through τc (thinner roads are more fan/speed
 *     sensitive), not a second hL slope;
 *   - coupon calibration ratios keep applying multiplicatively.
 *
 * CONFIDENCE: LOW until fitted. Every material constant below is a
 * literature-plausible engineering estimate (sources on each), locked by
 * regression tests (bond.test.ts) exactly like the Gibson-Ashby lattice
 * exponents, and overridable per printer/filament by the process-sweep fit
 * (fitBondCoeffs → CalibrationProfile.bondCoeffs).
 *
 * References:
 *   Bellehumeur, Li, Sun, Gu (2004), J Manuf Processes 6(2) — FDM bond
 *     formation, lumped-capacitance road cooling validated by experiment.
 *   Sun, Rizvi, Bellehumeur, Gu (2008), Rapid Prototyping J 14(2).
 *   Yang & Pitchumani (2002), Macromolecules 35 — non-isothermal healing.
 *   Pokluda, Bellehumeur, Vlachopoulos (1997), AIChE J 43 — sintering angle.
 *   Coogan & Kazmer (2017), Rapid Prototyping J 23(2) — bond strength vs
 *     speed/temperature/layer height; (2019) healing model for FDM welds.
 *   Seppala, Han, Hillgartner, Davis, Migler (2017), Soft Matter 13 — weld
 *     temperature history measurement in FDM.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Optional process settings block on PrintSettings (all user-optional). */
export interface ProcessSettings {
  nozzleTempC?:   number;
  bedTempC?:      number;
  printSpeedMmS?: number;
  /** Part-cooling fan duty, 0–100 %. */
  coolingFanPct?: number;
  ambientTempC?:  number;
}

/** Printer/filament-fitted overrides (CalibrationProfile.bondCoeffs). */
export interface BondModelCoeffs {
  /** Effective still-air convection coefficient h0, W/m²K (default 30). */
  hConv?:                 number | null;
  /** Arrhenius activation energy, kJ/mol (default per material). */
  activationEnergyKJmol?: number | null;
  /** Multiplier on the relative strength prediction (fit residual soak). */
  strengthPrefactor?:     number | null;
  /**
   * Void/consolidation sensitivity (default {@link VOID_TEMP_GAIN}). How hard a
   * cold interface (below the reference deposition temperature) penalizes
   * strength for incomplete inter-bead filling. 0 disables the void term.
   */
  voidSensitivity?:       number | null;
}

export interface BondPrediction {
  /** Multiplier on interlayer STRENGTHS (yieldZ, yieldZShear) vs reference. */
  relStrength: number;
  /** Multiplier on interlayer STIFFNESS (E_z, G_xz) vs reference. */
  relStiffness: number;
  /** Diagnostics for reporting. */
  interfaceTempC:  number;   // T0 — interface temperature at deposition
  substrateTempC:  number;   // substrate road temperature when the bead lands
  coolTimeConstS:  number;   // τc
  bondPotentialS:  number;   // Φ (Arrhenius-weighted seconds above Tg)
  refPotentialS:   number;   // Φ_ref at the reference condition
  consolidation:   number;   // void/consolidation factor (1.0 at/above reference temp)
  clamped:         boolean;  // true when the raw ratio hit the clamp
  confidence:      "low" | "medium";
  /**
   * False when the material id has no entry in {@link BOND_MATERIALS} (issue
   * #186): the bond path was REFUSED rather than silently run on PLA physics, so
   * the multipliers are the reference no-op (1.0) and the diagnostic temps are
   * NaN. Callers must surface `note` and must NOT read the temp fields.
   */
  supported:       boolean;
  note:            string;
}

// ─── Material constants (ALL confidence LOW — see module docblock) ──────────

interface BondMaterialParams {
  /** Reference (typical) nozzle temperature, °C. */
  nozzleRefC: number;
  /** Glass transition (bond formation stops ~Tg), °C. */
  TgC:        number;
  /** Arrhenius activation energy for viscous flow / reptation, kJ/mol. */
  EaKJmol:    number;
  /** Solid density kg/m³ and specific heat J/(kg·K) for τc. */
  rho:        number;
  cp:         number;
}

/**
 * Per-material bond physics constants. Ea values are melt-rheology
 * activation energies (PLA ~50–80, ABS ~90–110, PETG ~60–80 kJ/mol in the
 * rheology literature); Tg from datasheets; cp typical of the solid near Tg.
 * TPU: Tg is below room temperature — bonding is not diffusion-limited the
 * same way; the entry keeps the integral finite and the trends mild.
 */
export const BOND_MATERIALS: Record<string, BondMaterialParams> = {
  pla:   { nozzleRefC: 210, TgC:  60, EaKJmol: 60, rho: 1240, cp: 1800 },
  petg:  { nozzleRefC: 240, TgC:  80, EaKJmol: 70, rho: 1270, cp: 1700 },
  abs:   { nozzleRefC: 245, TgC: 105, EaKJmol: 95, rho: 1050, cp: 1900 },
  tpu:   { nozzleRefC: 225, TgC:  25, EaKJmol: 45, rho: 1200, cp: 1800 },
  pa12:  { nozzleRefC: 255, TgC:  50, EaKJmol: 65, rho: 1010, cp: 2100 },
  asa:   { nozzleRefC: 245, TgC: 100, EaKJmol: 90, rho: 1070, cp: 1900 },
};

/** True when the bond property table carries physics for this material id (issue #186). */
export function isKnownBondMaterial(materialId: string): boolean {
  return Object.prototype.hasOwnProperty.call(BOND_MATERIALS, materialId);
}

/** Reference process condition (nozzle temp is per-material). */
export const BOND_REFERENCE = {
  printSpeedMmS: 60,
  coolingFanPct: 100,
  bedTempC:      60,
  ambientTempC:  25,
} as const;

// Model constants (LOW confidence, regression-locked in bond.test.ts):
const H0_WPM2K       = 30;   // still-air effective convection (Coogan & Kazmer 2019: 20–90 measured band)
const FAN_H_GAIN     = 1.0;  // full fan doubles h_eff
const BED_ENV_WEIGHT = 0.3;  // how much the bed temperature lifts the road's environment
const PASS_LENGTH_MM = 30;   // characteristic toolpath return distance for the inter-pass time
const TG_STOP_MARGIN = 5;    // °C above Tg where bonding effectively stops
const PHI_TIME_CAP_S = 120;  // integration cap (heated-chamber safety)
const STRENGTH_EXP   = 0.75; // Φ^(1/2) neck × Φ^(1/4) healing
// Void / consolidation term (LOW confidence, regression-locked in bond.test.ts).
// Below the reference interface temperature the melt is too viscous to spread
// and fully fill inter-bead valleys, leaving triangular voids that cut strength
// beyond what interlayer diffusion (Φ) alone predicts. Anchored so the reference
// condition is EXACTLY 1.0 (bit-identity), and driven by the SAME interface
// temperature already computed — it reinforces the cold⇒weaker direction, so no
// locked trend flips, and introduces no standalone layer-height slope.
const VOID_TEMP_GAIN = 0.35; // strength lost per unit normalized temperature deficit
const VOID_FLOOR     = 0.6;  // floor on the consolidation factor
const REL_S_CLAMP: readonly [number, number] = [0.4, 1.5];
const REL_E_CLAMP: readonly [number, number] = [0.6, 1.25];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ─── Core physics ────────────────────────────────────────────────────────────

interface ThermalResult {
  phi:   number;   // Arrhenius-weighted bond potential, s
  T0:    number;   // interface temperature at deposition, °C
  Tsub:  number;   // substrate temperature when the bead lands, °C
  tauC:  number;   // cooling time constant, s
}

function thermalBondPotential(
  mat: BondMaterialParams,
  layerHeightMm: number,
  proc: Required<Pick<ProcessSettings, "printSpeedMmS" | "coolingFanPct" | "bedTempC" | "ambientTempC">> & { nozzleTempC: number },
  h0: number,
  EaKJmol: number,
  passLengthMmOverride?: number,
): ThermalResult {
  const hL_m  = clamp(layerHeightMm, 0.04, 1.0) / 1000;
  const fan   = clamp(proc.coolingFanPct, 0, 100) / 100;
  const speed = clamp(proc.printSpeedMmS, 1, 1000);
  const Tn    = clamp(proc.nozzleTempC, mat.TgC + 20, 500);

  const Tenv = proc.ambientTempC + BED_ENV_WEIGHT * (proc.bedTempC - proc.ambientTempC);
  const hEff = h0 * (1 + FAN_H_GAIN * fan);
  // τc = ρ·cp·A/(h·P) with A = (π/4)·w·hL and P ≈ 2w → π·ρ·cp·hL/(8·h).
  // The extrusion width cancels — the road's thermal depth is its height.
  const tauC = (Math.PI * mat.rho * mat.cp * hL_m) / (8 * hEff);

  // Substrate road cooled for one inter-pass time before the bead lands.
  // Default: characteristic toolpath return distance (one Z-layer later, at
  // roughly the same XY spot). Callers modeling a DIFFERENT revisit geometry
  // (e.g. wall-to-wall bonding, where the "return" is finishing one full
  // perimeter loop before starting the next) pass their own pass length.
  const tPass = (passLengthMmOverride ?? PASS_LENGTH_MM) / speed;
  const Tsub  = Tenv + (Tn - Tenv) * Math.exp(-tPass / tauC);
  // Interface starts at the mix of the incoming melt and the substrate
  // (equal thermal masses — first-order).
  const T0 = 0.5 * (Tn + Tsub);

  // Φ = ∫ exp(−Ea/R (1/T − 1/T_ref)) dt while T > Tg + margin.
  const R = 8.314;
  const Ea = EaKJmol * 1000;
  const TrefK = mat.nozzleRefC + 273.15;
  const Tstop = mat.TgC + TG_STOP_MARGIN;
  const dt = tauC / 50;
  let phi = 0;
  for (let t = 0; t < PHI_TIME_CAP_S; t += dt) {
    const T = Tenv + (T0 - Tenv) * Math.exp(-t / tauC);
    if (T <= Tstop) break;
    phi += dt * Math.exp(-(Ea / R) * (1 / (T + 273.15) - 1 / TrefK));
  }
  return { phi, T0, Tsub, tauC };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** True when the process block carries at least one meaningful field. */
export function hasProcessSettings(proc: ProcessSettings | undefined | null): proc is ProcessSettings {
  return !!proc && (
    proc.nozzleTempC   != null ||
    proc.printSpeedMmS != null ||
    proc.coolingFanPct != null ||
    proc.bedTempC      != null ||
    proc.ambientTempC  != null
  );
}

/**
 * Predict the interlayer bond multipliers for the given process settings,
 * RELATIVE to the reference condition at the same layer height (see module
 * docblock — multiplies on top of layerHeightFactor and calibration ratios).
 */
export function predictBondMultipliers(
  materialId:    string,
  layerHeightMm: number,
  proc:          ProcessSettings,
  coeffs?:       BondModelCoeffs | null,
  /**
   * Override for the characteristic inter-pass revisit distance (default
   * PASS_LENGTH_MM, tuned for the Z/interlayer revisit geometry). Pass a
   * different value when modeling a differently-shaped revisit pattern —
   * e.g. wall-to-wall bonding, where the relevant "return" is finishing one
   * full perimeter loop before starting the next.
   */
  passLengthMmOverride?: number,
): BondPrediction {
  const mat = BOND_MATERIALS[materialId];
  if (!mat) {
    // Unknown material (issue #186): NEVER silently substitute PLA bond physics.
    // For e.g. a PA-CF (nozzle ~280 °C, Tg ~180 °C) the PLA constants
    // (Tg 60, nozzleRef 210, Ea 60) are catastrophically wrong. Refuse the bond
    // path by returning the reference (no-op) multipliers of exactly 1.0 — which
    // reproduces the legacy no-process behavior bit-for-bit in the material
    // builders — with a disclosed note the caller surfaces (materialModel.bond).
    return {
      relStrength: 1, relStiffness: 1,
      interfaceTempC: NaN, substrateTempC: NaN, coolTimeConstS: NaN,
      bondPotentialS: NaN, refPotentialS: NaN, consolidation: 1,
      clamped: false, confidence: "low", supported: false,
      note: `Bond model skipped: material "${materialId}" has no entry in the bond property table (BOND_MATERIALS). ` +
            `Falling back to the reference (no-process) interlayer behavior — NOT PLA physics. ` +
            `Add sourced bond constants for this material to enable process-aware bonding.`,
    };
  }
  const h0  = coeffs?.hConv ?? H0_WPM2K;
  const Ea  = coeffs?.activationEnergyKJmol ?? mat.EaKJmol;
  const pre = coeffs?.strengthPrefactor ?? 1.0;

  const filled = {
    nozzleTempC:   proc.nozzleTempC   ?? mat.nozzleRefC,
    printSpeedMmS: proc.printSpeedMmS ?? BOND_REFERENCE.printSpeedMmS,
    coolingFanPct: proc.coolingFanPct ?? BOND_REFERENCE.coolingFanPct,
    bedTempC:      proc.bedTempC      ?? BOND_REFERENCE.bedTempC,
    ambientTempC:  proc.ambientTempC  ?? BOND_REFERENCE.ambientTempC,
  };
  const refProc = {
    nozzleTempC:   mat.nozzleRefC,
    printSpeedMmS: BOND_REFERENCE.printSpeedMmS,
    coolingFanPct: BOND_REFERENCE.coolingFanPct,
    bedTempC:      BOND_REFERENCE.bedTempC,
    ambientTempC:  BOND_REFERENCE.ambientTempC,
  };

  const cur = thermalBondPotential(mat, layerHeightMm, filled, h0, Ea, passLengthMmOverride);
  const ref = thermalBondPotential(mat, layerHeightMm, refProc, h0, Ea, passLengthMmOverride);

  // Void/consolidation factor: 1.0 when the interface is at/above the reference
  // deposition temperature, dropping toward VOID_FLOOR as it cools toward Tg.
  // cur.T0 == ref.T0 at the reference condition ⇒ deficit 0 ⇒ EXACTLY 1.0.
  const voidGain = coeffs?.voidSensitivity ?? VOID_TEMP_GAIN;
  const refMargin = Math.max(ref.T0 - mat.TgC, 1e-6);
  const deficit   = Math.max(0, (refMargin - (cur.T0 - mat.TgC))) / refMargin;
  const consolidation = clamp(1 - voidGain * deficit, VOID_FLOOR, 1);

  const rawRatio = pre * Math.pow(cur.phi / Math.max(ref.phi, 1e-9), STRENGTH_EXP) * consolidation;
  const relStrength  = clamp(rawRatio, REL_S_CLAMP[0], REL_S_CLAMP[1]);
  const relStiffness = clamp(Math.sqrt(Math.max(rawRatio, 1e-9)), REL_E_CLAMP[0], REL_E_CLAMP[1]);
  const clamped = relStrength !== rawRatio;

  const fitted = !!(coeffs && (coeffs.hConv != null || coeffs.activationEnergyKJmol != null || coeffs.strengthPrefactor != null || coeffs.voidSensitivity != null));
  return {
    relStrength,
    relStiffness,
    interfaceTempC: cur.T0,
    substrateTempC: cur.Tsub,
    coolTimeConstS: cur.tauC,
    bondPotentialS: cur.phi,
    refPotentialS:  ref.phi,
    consolidation,
    clamped,
    confidence: fitted ? "medium" : "low",
    supported: true,
    note: `Bond model (${fitted ? "sweep-fitted" : "literature constants, LOW confidence"}): ` +
          `interface ${cur.T0.toFixed(0)}°C on a ${cur.Tsub.toFixed(0)}°C substrate, τc=${cur.tauC.toFixed(1)}s, ` +
          `Φ/Φ_ref=${(cur.phi / Math.max(ref.phi, 1e-9)).toFixed(2)}` +
          (consolidation < 1 ? `, consolidation ×${consolidation.toFixed(2)} (cold-deposition voids)` : "") +
          ` → strength ×${relStrength.toFixed(2)}, stiffness ×${relStiffness.toFixed(2)}` +
          (clamped ? " (clamped)" : ""),
  };
}

// ─── Process-sweep coefficient fitting ───────────────────────────────────────

/** One physical sweep point: settings + the measured Z-tension strength. */
export interface BondSweepPoint {
  layerHeightMm:   number;
  nozzleTempC?:    number;
  printSpeedMmS?:  number;
  coolingFanPct?:  number;
  bedTempC?:       number;
  ambientTempC?:   number;
  /** Measured interlayer tensile strength at these settings, MPa. */
  measuredSztMPa:  number;
}

/**
 * Fit-quality gate for the process sweep (issue #179). `rmsePct` is the RMS of
 * (predicted − measured) Z-tension strength as a percentage of the mean
 * measured strength. A clean sweep — even the coarse 6-point one in
 * bond.test.ts — fits to < ~2%; a sweep whose scatter or outliers the physical
 * bond model structurally cannot reproduce runs far higher. Above this bound
 * the fitted coefficients are not a trustworthy relative correction, so the
 * calibration endpoint REFUSES them (400) rather than letting them silently
 * override the literature defaults — and lift bond confidence LOW→MEDIUM — in
 * every subsequent process-aware analysis. 15% leaves generous headroom over a
 * clean fit while still catching gross noise or a single mislabeled datum.
 */
export const BOND_FIT_RMSE_MAX_PCT = 15;

/** One fitted sweep datum with its residual, in input order. */
export interface BondFitPoint {
  index:        number;
  measuredMPa:  number;
  predictedMPa: number;
  /** (predicted − measured) / measured × 100, signed. */
  deviationPct: number;
}

export interface BondFitResult {
  coeffs:   Required<Pick<BondModelCoeffs, "hConv" | "activationEnergyKJmol" | "strengthPrefactor" | "voidSensitivity">>;
  rmsePct:  number;
  /** "good" when rmsePct ≤ BOND_FIT_RMSE_MAX_PCT, else "poor" (issue #179). */
  fitQuality: "good" | "poor";
  points:   BondFitPoint[];
  /** The single worst-fit datum (largest |deviationPct|) — reject diagnostics. */
  worstPoint: BondFitPoint;
}

/**
 * Least-squares fit of {hConv, Ea, strengthPrefactor} to measured Z-tension
 * strengths across a process sweep (coarse grid + two coordinate-descent
 * refinement passes; the model is ~10⁴ flops per point, so exhaustive search
 * is cheap). The prediction for a point is
 *   S_zt = yieldXY_ref × yZratio × lhf(hL) × relStrength(point | coeffs)
 * with lhf the standard layerHeightFactor — the caller supplies both scalars
 * so this module stays free of analysis.ts imports.
 */
export function fitBondCoeffs(
  materialId: string,
  points: BondSweepPoint[],
  yieldXYMPa: number,
  yZRatio: number,
  layerHeightFactorFn: (lh: number) => number,
): BondFitResult {
  if (points.length < 3) {
    throw new Error("fitBondCoeffs needs ≥3 sweep points with measured Z-tension strengths.");
  }
  if (!isKnownBondMaterial(materialId)) {
    // Issue #186: fitting against PLA physics for an unknown material would hand
    // back coefficients calibrated to the wrong reference — refuse instead.
    throw new Error(`fitBondCoeffs: material "${materialId}" has no entry in the bond property table (BOND_MATERIALS).`);
  }
  const sse = (h: number, ea: number, pre: number, vs: number): number => {
    let s = 0;
    for (const p of points) {
      const rel = predictBondMultipliers(materialId, p.layerHeightMm, p, {
        hConv: h, activationEnergyKJmol: ea, strengthPrefactor: pre, voidSensitivity: vs,
      }).relStrength;
      const pred = yieldXYMPa * yZRatio * layerHeightFactorFn(p.layerHeightMm) * rel;
      s += (pred - p.measuredSztMPa) ** 2;
    }
    return s;
  };

  // Coarse grid over the three thermal params at the default void sensitivity.
  let best = { h: H0_WPM2K, ea: BOND_MATERIALS[materialId]!.EaKJmol, pre: 1.0, vs: VOID_TEMP_GAIN };
  let bestSse = sse(best.h, best.ea, best.pre, best.vs);
  for (const h of [20, 30, 45, 60, 80]) {
    for (const ea of [40, 55, 70, 90, 110]) {
      for (const pre of [0.8, 0.9, 1.0, 1.1, 1.2]) {
        const v = sse(h, ea, pre, best.vs);
        if (v < bestSse) { bestSse = v; best = { ...best, h, ea, pre }; }
      }
    }
  }
  // Two coordinate-descent refinement passes (void sensitivity now in the mix).
  for (let pass = 0; pass < 2; pass++) {
    for (const key of ["h", "ea", "pre", "vs"] as const) {
      const span = key === "h" ? 8 : key === "ea" ? 10 : key === "pre" ? 0.06 : 0.1;
      for (const d of [-span, -span / 2, span / 2, span]) {
        const cand = { ...best, [key]: best[key] + d };
        if (cand.h < 5 || cand.ea < 20 || cand.pre < 0.5 || cand.pre > 1.6 || cand.vs < 0 || cand.vs > 0.8) continue;
        const v = sse(cand.h, cand.ea, cand.pre, cand.vs);
        if (v < bestSse) { bestSse = v; best = cand; }
      }
    }
  }

  const fitted: BondModelCoeffs = {
    hConv: best.h, activationEnergyKJmol: best.ea, strengthPrefactor: best.pre, voidSensitivity: best.vs,
  };
  const outPoints: BondFitPoint[] = points.map((p, index) => {
    const rel = predictBondMultipliers(materialId, p.layerHeightMm, p, fitted).relStrength;
    const predictedMPa = yieldXYMPa * yZRatio * layerHeightFactorFn(p.layerHeightMm) * rel;
    return {
      index,
      measuredMPa: p.measuredSztMPa,
      predictedMPa,
      deviationPct: p.measuredSztMPa > 0 ? ((predictedMPa - p.measuredSztMPa) / p.measuredSztMPa) * 100 : 0,
    };
  });
  const meanMeasured = points.reduce((s, p) => s + p.measuredSztMPa, 0) / points.length;
  const rmse = Math.sqrt(bestSse / points.length);
  const rmsePct = meanMeasured > 0 ? (rmse / meanMeasured) * 100 : 0;
  // Worst datum by absolute deviation — named in the reject diagnostics so the
  // user knows which sweep point to re-check (bad thermocouple, mixed filament).
  const worstPoint = outPoints.reduce((w, p) =>
    Math.abs(p.deviationPct) > Math.abs(w.deviationPct) ? p : w, outPoints[0]!);
  return {
    coeffs: { hConv: best.h, activationEnergyKJmol: best.ea, strengthPrefactor: best.pre, voidSensitivity: best.vs },
    rmsePct,
    fitQuality: rmsePct <= BOND_FIT_RMSE_MAX_PCT ? "good" : "poor",
    points: outPoints,
    worstPoint,
  };
}
