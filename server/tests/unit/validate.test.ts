/**
 * validate.test.ts — request-shape checker (issue #106).
 *
 * The `expect` checker guards every POST route: a malformed body must be
 * rejected with a precise field path + hint BEFORE any heavy work (base64
 * decode, meshing, solving) runs. These tests pin the spec language and the
 * exact failure shapes the client renders.
 */

import { describe, it, expect as vexpect } from "vitest";
import { expect as expectShape, ValidationError, type Spec } from "../../validate.js";

function failure(value: unknown, spec: Spec): ValidationError {
  try {
    expectShape(value, spec);
  } catch (e) {
    if (e instanceof ValidationError) return e;
    throw e;
  }
  throw new Error("expected ValidationError, but validation passed");
}

describe("expect — primitives", () => {
  it("accepts matching primitives", () => {
    expectShape("hi", "string");
    expectShape(1.5, "number");
    expectShape(true, "boolean");
    expectShape({ a: 1 }, "object");
    expectShape(undefined, "any");
  });

  it("rejects wrong primitive types with the offending path", () => {
    const err = failure(42, "string");
    vexpect(err.field).toBe("body");
    vexpect(err.hint).toContain("expected a string");
    vexpect(err.hint).toContain("number");
  });

  it("rejects NaN and Infinity for \"number\"", () => {
    vexpect(failure(NaN, "number").hint).toContain("finite");
    vexpect(failure(Infinity, "number").hint).toContain("finite");
  });

  it("rejects arrays and null for \"object\"", () => {
    failure([], "object");
    failure(null, "object");
  });
});

describe("expect — unions and vec3", () => {
  it("accepts literal union members", () => {
    expectShape("stl", "stl|step");
    expectShape("step", "stl|step");
  });

  it("rejects values outside the union, echoing the value", () => {
    const err = failure("obj", "stl|step");
    vexpect(err.hint).toContain("stl | step");
    vexpect(err.hint).toContain('"obj"');
  });

  it("mixes primitive names and literals in a union", () => {
    expectShape(3, "number|auto");
    expectShape("auto", "number|auto");
    failure("manual", "number|auto");
  });

  it("vec3 requires exactly 3 finite numbers", () => {
    expectShape([1, 2, 3], "vec3");
    failure([1, 2], "vec3");
    failure([1, 2, "3"], "vec3");
    failure([1, 2, NaN], "vec3");
    failure("1,2,3", "vec3");
  });
});

describe("expect — objects and optionality", () => {
  const spec: Spec = { id: "string", "note?": "string" };

  it("reports a missing required field by name", () => {
    const err = failure({}, spec);
    vexpect(err.field).toBe("id");
    vexpect(err.hint).toBe("required field is missing");
  });

  it("treats missing, undefined and null as absent for optional fields", () => {
    expectShape({ id: "a" }, spec);
    expectShape({ id: "a", note: undefined }, spec);
    expectShape({ id: "a", note: null }, spec);
  });

  it("still type-checks optional fields when present", () => {
    const err = failure({ id: "a", note: 7 }, spec);
    vexpect(err.field).toBe("note");
  });

  it("allows extra keys (only asserts what the server consumes)", () => {
    expectShape({ id: "a", extra: 123 }, spec);
  });

  it("rejects non-objects where an object spec applies", () => {
    failure("not-an-object", spec);
    failure([{ id: "a" }], spec);
  });
});

describe("expect — arrays and nested paths", () => {
  const forcesSpec: Spec = {
    forces: [{ magnitude: "number", direction: "vec3", position: "vec3" }],
  };

  it("accepts a well-formed forces array", () => {
    expectShape(
      { forces: [{ magnitude: 50, direction: [0, 0, -1], position: [1, 2, 3] }] },
      forcesSpec,
    );
  });

  it("pinpoints the exact bad element and field (issue #106 motivating case)", () => {
    // The malformed body from the issue: {fx,fy,fz} instead of
    // {magnitude,direction,position}.
    const err = failure({ forces: [{ fx: 1, fy: 0, fz: 0 }] }, forcesSpec);
    vexpect(err.field).toBe("forces[0].magnitude");
    vexpect(err.hint).toBe("required field is missing");
  });

  it("indexes into later elements", () => {
    const good = { magnitude: 1, direction: [0, 0, 1], position: [0, 0, 0] };
    const err = failure({ forces: [good, { ...good, magnitude: "big" }] }, forcesSpec);
    vexpect(err.field).toBe("forces[1].magnitude");
  });

  it("rejects a non-array where an array is expected", () => {
    const err = failure({ forces: { magnitude: 1 } }, forcesSpec);
    vexpect(err.field).toBe("forces");
    vexpect(err.hint).toContain("expected an array");
  });

  it("accepts empty arrays (emptiness is a route-level rule, not a shape rule)", () => {
    expectShape({ forces: [] }, forcesSpec);
  });
});

describe("ValidationError envelope", () => {
  it("exposes field and hint separately and composes the message", () => {
    const err = failure({ a: { b: [1, "x"] } }, { a: { b: ["number"] } });
    vexpect(err.field).toBe("a.b[1]");
    vexpect(err.message).toBe(`Invalid request: a.b[1] — ${err.hint}`);
  });
});
