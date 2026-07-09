/**
 * validation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The prediction-vs-measurement scoreboard — the piece that turns STORMFEA
 * from a tool into a *validated* tool.
 *
 * Workflow: analyse a specimen (STORMFEA predicts the failure load), break it
 * physically (the real failure load), and record the pair here. Across a set of
 * specimens — e.g. the Taguchi L9 — the aggregate tells you the two things that
 * matter for validation:
 *
 *   1. BIAS — does the tool systematically over- or under-predict strength?
 *      A positive mean signed error means it predicts MORE strength than the
 *      part actually has: non-conservative, the dangerous direction.
 *   2. ACCURACY — how tight is the agreement (mean |error|, RMS, correlation)?
 *
 * Every case is flagged conservative (predicted ≤ measured → the tool erred on
 * the safe side) or non-conservative (predicted > measured → it called the part
 * stronger than it was). Non-conservative cases are the ones to scrutinise.
 */

export interface ValidationCase {
  id:             string;
  label:          string;
  partName:       string;
  /** STORMFEA's predicted failure load (estimatedFailForce), N. */
  predictedFailN: number;
  /** Physical test failure load, N. */
  measuredFailN:  number;
  governingMode?: string;
  materialId?:    string;
  orientation?:   string;
  layerHeightMm?: number;
  /** Was a calibrated profile active for the prediction? */
  calibrated?:    boolean;
  notes?:         string;
  createdAt:      string;
}

export interface ValidationDerived {
  /** (predicted − measured) / measured × 100. Signed: + = over-predicts strength. */
  errorPct:       number;
  ratio:          number;   // predicted / measured
  /** predicted ≤ measured → erred on the safe side. */
  conservative:   boolean;
}

export function deriveCase(c: ValidationCase): ValidationDerived {
  const m = c.measuredFailN;
  const errorPct = m > 0 ? ((c.predictedFailN - m) / m) * 100 : 0;
  const ratio    = m > 0 ? c.predictedFailN / m : 0;
  return { errorPct, ratio, conservative: c.predictedFailN <= m };
}

export interface ValidationStats {
  n:                  number;
  /** Mean signed error % (bias). + = non-conservative bias (over-predicts strength). */
  meanSignedErrorPct: number;
  /** Mean |error| % (accuracy). */
  meanAbsErrorPct:    number;
  /** RMS error % (penalises large misses). */
  rmsErrorPct:        number;
  /** Count predicted > measured (the unsafe direction). */
  nNonConservative:   number;
  /** Largest over-prediction (max signed error %), or null if none non-conservative. */
  worstNonConservativePct: number | null;
  worstNonConservativeId:  string | null;
  /** Fraction with |error| ≤ bandPct. */
  pctWithinBand:      number;
  bandPct:            number;
  /** Pearson r of predicted vs measured across cases (null if n < 2 or degenerate). */
  correlation:        number | null;
}

export function computeStats(cases: ValidationCase[], bandPct = 25): ValidationStats {
  const n = cases.length;
  if (n === 0) {
    return {
      n: 0, meanSignedErrorPct: 0, meanAbsErrorPct: 0, rmsErrorPct: 0,
      nNonConservative: 0, worstNonConservativePct: null, worstNonConservativeId: null,
      pctWithinBand: 0, bandPct, correlation: null,
    };
  }

  const derived = cases.map(c => ({ c, d: deriveCase(c) }));

  let sumSigned = 0, sumAbs = 0, sumSq = 0, within = 0, nNonCons = 0;
  let worstPct: number | null = null, worstId: string | null = null;

  for (const { c, d } of derived) {
    sumSigned += d.errorPct;
    sumAbs    += Math.abs(d.errorPct);
    sumSq     += d.errorPct * d.errorPct;
    if (Math.abs(d.errorPct) <= bandPct) within++;
    if (!d.conservative) {
      nNonCons++;
      if (worstPct === null || d.errorPct > worstPct) { worstPct = d.errorPct; worstId = c.id; }
    }
  }

  // Pearson correlation of predicted vs measured.
  let correlation: number | null = null;
  if (n >= 2) {
    const px = cases.map(c => c.predictedFailN);
    const mx = cases.map(c => c.measuredFailN);
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const pm = mean(px), mm = mean(mx);
    let cov = 0, vp = 0, vm = 0;
    for (let i = 0; i < n; i++) {
      const dp = px[i]! - pm, dmv = mx[i]! - mm;
      cov += dp * dmv; vp += dp * dp; vm += dmv * dmv;
    }
    correlation = (vp > 0 && vm > 0) ? cov / Math.sqrt(vp * vm) : null;
  }

  return {
    n,
    meanSignedErrorPct: sumSigned / n,
    meanAbsErrorPct:    sumAbs / n,
    rmsErrorPct:        Math.sqrt(sumSq / n),
    nNonConservative:   nNonCons,
    worstNonConservativePct: worstPct,
    worstNonConservativeId:  worstId,
    pctWithinBand:      (within / n) * 100,
    bandPct,
    correlation,
  };
}
