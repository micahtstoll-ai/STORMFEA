/**
 * validate.ts
 * -----------
 * Tiny hand-rolled request-shape checker (issue #106). No dependencies.
 *
 * Every POST route validates its body with `expect(body, spec)` BEFORE any
 * heavy work (base64 decode, meshing, solving). A mismatch throws
 * `ValidationError`, which routes turn into the uniform error envelope:
 *
 *     400 { error: string, field: string, hint: string }
 *
 * Spec language (deliberately minimal):
 *   - "string" | "number" | "boolean" | "object" | "any"  — primitive checks.
 *     "number" additionally requires a finite value (no NaN/Infinity);
 *     "object" means a plain non-null, non-array object.
 *   - "vec3" — an array of exactly 3 finite numbers, e.g. a position/normal.
 *   - "a|b|c" — a union: each alternative is either a primitive name above
 *     or a string literal the value must equal (e.g. "stl|step").
 *   - [spec] — an array whose every element matches `spec`.
 *   - { key: spec, "optKey?": spec } — an object; keys ending in "?" are
 *     optional (missing, undefined, or null all accepted). Extra keys are
 *     allowed — the checker only asserts what the server actually consumes.
 */

export class ValidationError extends Error {
  readonly field: string;
  readonly hint:  string;
  constructor(field: string, hint: string) {
    super(`Invalid request: ${field} — ${hint}`);
    this.field = field;
    this.hint  = hint;
  }
}

export type Spec = string | readonly Spec[] | { readonly [key: string]: Spec };

const PRIMITIVES = new Set(["string", "number", "boolean", "object", "any"]);

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number" && !Number.isFinite(v)) return String(v); // NaN / Infinity
  return typeof v;
}

function matchesPrimitive(value: unknown, prim: string): boolean {
  switch (prim) {
    case "any":     return true;
    case "number":  return typeof value === "number" && Number.isFinite(value);
    case "object":  return typeof value === "object" && value !== null && !Array.isArray(value);
    default:        return typeof value === prim;
  }
}

export function expect(value: unknown, spec: Spec, path = "body"): void {
  if (typeof spec === "string") {
    if (spec === "vec3") {
      const ok = Array.isArray(value) && value.length === 3 &&
                 value.every(n => typeof n === "number" && Number.isFinite(n));
      if (!ok) throw new ValidationError(path, `expected an array of 3 finite numbers, got ${typeName(value)}`);
      return;
    }
    const alts = spec.split("|");
    const ok = alts.some(alt =>
      PRIMITIVES.has(alt) ? matchesPrimitive(value, alt) : value === alt);
    if (!ok) {
      const what = alts.length > 1 ? `one of ${alts.join(" | ")}`
                 : spec === "number" ? "a finite number"
                 : `a ${spec}`;
      throw new ValidationError(path, `expected ${what}, got ${typeName(value)}${typeof value === "string" ? ` "${value.slice(0, 40)}"` : ""}`);
    }
    return;
  }

  if (Array.isArray(spec)) {
    if (!Array.isArray(value)) {
      throw new ValidationError(path, `expected an array, got ${typeName(value)}`);
    }
    const elemSpec = spec[0] as Spec;
    for (let i = 0; i < value.length; i++) {
      expect(value[i], elemSpec, `${path}[${i}]`);
    }
    return;
  }

  // Object spec
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(path, `expected an object, got ${typeName(value)}`);
  }
  const obj = value as Record<string, unknown>;
  for (const [key, subSpec] of Object.entries(spec)) {
    const optional = key.endsWith("?");
    const name     = optional ? key.slice(0, -1) : key;
    const child    = obj[name];
    const childPath = path === "body" ? name : `${path}.${name}`;
    if (child === undefined || child === null) {
      if (optional) continue;
      throw new ValidationError(childPath, "required field is missing");
    }
    expect(child, subSpec, childPath);
  }
}
