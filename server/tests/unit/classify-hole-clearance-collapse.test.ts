/**
 * classify-hole-clearance-collapse.test.ts — issue #290.
 * --------------------------------------------------------
 * classifyHole matches a detected diameter against every BOLT_SIZES row and
 * flags "ambiguous" whenever more than one candidate lands within half of
 * MATCH_TOL. Two rows — #10-24 and #10-32 — share IDENTICAL clearance-close
 * (5.16mm) and clearance-free (5.61mm) diameters, because thread pitch does
 * not move a clearance-hole diameter. Before this fix, matching either value
 * always reported "ambiguous #10-24 vs #10-32" — a distinction no measurement
 * precision can ever resolve, since the two entries are numerically identical
 * at the dimension being compared.
 *
 * The fix (server/analysis.ts, classifyHole): collapse same-type, same-value
 * matches into one answer — `bolt.label` names every tied fastener instead of
 * arbitrarily picking one and reporting a phantom ambiguity — and reserve the
 * "ambiguous" type for candidates that differ in dimension or in match type
 * (clearance vs. tap drill), which is a real, resolvable-in-principle
 * question. `warning` stays null on a resolved twin group: the diameter and
 * type ARE known, so report.ts's OK/warning coloring must not repaint a
 * correctly-identified hole as a defect.
 *
 * Only #10-24/#10-32 collide in the current table (verified by sweeping every
 * BOLT_SIZES column for duplicate values), and only on the clearance columns
 * — never tapDrill75/50 — so this fix can never flip a hole's `type` into or
 * out of "tapped_75"/"tapped_50", the only two types checkFailureModes'
 * thread strip-out gate reads. Zero blast radius on governing safety factor.
 */

import { describe, it, expect } from "vitest";
import { classifyHole, BOLT_SIZES } from "../../analysis.js";
import { parseSTL } from "../../stl.js";
import { detectHoles } from "../../holes.js";
import {
  DEMO_BRACKET, generateDemoBracket, generateLBracket, generateArmPivot,
} from "../../demo_part.js";

describe("#290: same-clearance twins collapse instead of reporting phantom ambiguity", () => {
  it("a hole isolated at the #10 clearance-free tie (5.61mm) resolves cleanly", () => {
    // At exactly 5.61mm, #10-24 and #10-32 tie for best match (both 0.00mm
    // off) and no other BOLT_SIZES row lands within the 0.10mm ambiguity band
    // (the nearest independent candidate, M5 clearance-free at 5.50mm, sits
    // 0.11mm away) — so this diameter isolates the twin-collapse from any
    // other source of ambiguity.
    const cls = classifyHole(5.61 / 2, 100);
    expect(cls.type).toBe("clearance_free");
    expect(cls.bolt?.label).toBe("#10-24 / #10-32");
    expect(cls.warning).toBeNull();
  });

  it("does not report ambiguity BETWEEN #10-24 and #10-32 at the clearance-close tie (5.16mm)", () => {
    // At 5.16mm a THIRD, independent candidate (1/4-20 75%-thread tap drill,
    // 5.11mm, delta 0.05mm) also falls inside the ambiguity band — a
    // genuinely different size, not a twin — so this hole legitimately stays
    // "ambiguous". What must NOT happen is the #10-24/#10-32 non-answer
    // reappearing as the reported alternative.
    const cls = classifyHole(5.16 / 2, 100);
    expect(cls.type).toBe("ambiguous");
    expect(cls.warning).not.toContain("#10-32");
    expect(cls.warning).toContain("1/4-20");
  });

  it("BOLT_SIZES collides ONLY on the clearance columns, never on a tap drill", () => {
    // This is the whole safety argument for the change, checked against the
    // real table rather than asserted in a comment. classifyHole's twin
    // collapse suppresses a reported ambiguity, so it must never fire between
    // two TAPPED candidates: tapped_75/tapped_50 are the only types gating the
    // thread strip-out check in checkFailureModes, and silently collapsing a
    // genuine tapped-vs-tapped ambiguity would move a governing safety factor.
    // Today no tap-drill duplicates exist, so the collapse is unreachable on
    // those columns. If a future BOLT_SIZES edit introduces one, this fails.
    const collisions = (col: keyof typeof BOLT_SIZES[number]) => {
      const byValue = new Map<number, string[]>();
      for (const b of BOLT_SIZES) {
        const v = b[col] as number;
        byValue.set(v, [...(byValue.get(v) ?? []), b.label]);
      }
      return [...byValue.entries()].filter(([, labels]) => labels.length > 1);
    };

    // The tap-drill columns must be collision-free.
    expect(collisions("tapDrill75")).toEqual([]);
    expect(collisions("tapDrill50")).toEqual([]);

    // The clearance columns collide exactly once each, and only #10-24/#10-32.
    expect(collisions("clearanceClose")).toEqual([[5.16, ["#10-24", "#10-32"]]]);
    expect(collisions("clearanceFree")).toEqual([[5.61, ["#10-24", "#10-32"]]]);
  });
});

describe("#290: a genuine size ambiguity still reports ambiguous", () => {
  it("2.20mm ties M2 clearance-close against M2.5's 50%-thread tap drill", () => {
    // Same exact-tie MECHANISM as the #10 case (both BOLT_SIZES values equal
    // 2.20mm) but across a type boundary (clearance vs. tapped) and different
    // bolts (M2 vs M2.5) — a real "is this hole meant for clearance or
    // tapping" question, which the collapse logic must NOT suppress.
    const cls = classifyHole(2.2 / 2, 100);
    expect(cls.type).toBe("ambiguous");
    expect(cls.bolt?.label).toBe("M2");
    expect(cls.warning).toContain("M2.5");
  });
});

describe("#290: demo part ground truth (bracket, l-bracket, arm-pivot)", () => {
  // All three shipped demo parts drill their bolt hole at radius 2.6mm
  // (Ø5.2), so all three hit the identical classifyHole path.
  const parts: Array<[string, () => Buffer, number]> = [
    ["bracket",    generateDemoBracket, DEMO_BRACKET.depthMm],
    ["l-bracket",  generateLBracket,    36],
    ["arm-pivot",  generateArmPivot,    16],
  ];

  for (const [name, generate, plateDim] of parts) {
    it(`${name}: Ø5.2 hole no longer reports the #10-24/#10-32 non-answer`, () => {
      const stl = parseSTL(generate());
      const holes = detectHoles(stl.positions, stl.triangleCount);
      expect(holes).toHaveLength(1);
      const cls = classifyHole(holes[0]!.radius, plateDim);
      expect(cls.detectedDiamMm).toBeCloseTo(5.2, 5);

      // NOT fully resolved: a second, INDEPENDENT candidate sits closer than
      // the ambiguity band even after the twin collapses. M6's 50%-thread tap
      // drill (5.25mm, delta 0.05mm) is only 0.01mm further from 5.2mm than
      // the #10 clearance-close match (5.16mm, delta 0.04mm) — a genuinely
      // different size, not a duplicate, so classifyHole correctly still
      // calls it ambiguous. This is a real, pre-existing property of the
      // ambiguity band (an absolute half-MATCH_TOL threshold, not one scaled
      // to how much better the best match is) that #290 does not ask to be
      // changed — tracked separately, not silently reinterpreted here.
      expect(cls.type).toBe("ambiguous");

      // What DID change: the reported alternative is now a real, physically
      // different candidate (M6 tapped 50%) instead of the #10-24/#10-32
      // non-answer that no measurement could ever settle.
      expect(cls.warning).not.toContain("#10-32");
      expect(cls.warning).toContain("#10-24");
      expect(cls.warning).toContain("M6");
    });
  }
});
