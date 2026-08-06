/**
 * onshape-signing.test.ts
 * ------------------------
 * Locks the Onshape APIKey HMAC signing scheme (issue #277) to Onshape's
 * documented reference (`onshape-public/apikey`, `_make_auth`):
 *
 *   (method + '\n' + nonce + '\n' + date + '\n' + ctype + '\n' +
 *    path + '\n' + query + '\n').lower()
 *
 * Two independent defects previously broke every call:
 *   1. The signed string was missing its TRAILING newline after `query`
 *      (an Array#join('\n') with a trailing '' element produces
 *      "...path\nquery" with no final '\n', one byte short).
 *   2. Content-Type was signed as '' for GET requests but SENT as
 *      'application/json', so Onshape's server-side recomputed HMAC
 *      (from the header it actually received) never matched ours.
 *
 * These tests pin the exact signed-string bytes for a fixed input tuple,
 * computed independently here (not via buildOnshapeHmacString itself), and
 * verify the sent Content-Type header always equals the signed one.
 */

import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { buildOnshapeHmacString, buildOnshapeRequest } from "../../onshape.js";
import type { OnshapeCredentials } from "../../onshape.js";

describe("buildOnshapeHmacString (issue #277)", () => {
  it("matches Onshape's reference string byte-for-byte, including the trailing newline", () => {
    const method = "GET";
    const nonce  = "abc123DEF456abc123DEF456abc12345";
    const date   = "Thu, 06 Aug 2026 00:00:00 GMT";
    const ct     = "application/json";
    const path   = "/api/partstudios/d/DID/w/WID/e/EID/parts";
    const query  = "";

    const got = buildOnshapeHmacString(method, nonce, date, ct, path, query);

    // Independently reconstructed reference string — deliberately NOT built
    // by calling the function under test, so a future refactor that drops
    // the trailing newline (or reintroduces the join('\n') bug) fails here.
    const expected = (
      method + "\n" +
      nonce + "\n" +
      date + "\n" +
      ct + "\n" +
      path + "\n" +
      query + "\n"
    ).toLowerCase();

    expect(got).toBe(expected);
    // Pin the literal bytes too (with \n made visible) so the test doesn't
    // silently pass if both `got` and `expected` regress the same way.
    expect(got).toBe(
      "get\nabc123def456abc123def456abc12345\nthu, 06 aug 2026 00:00:00 gmt\n" +
      "application/json\n/api/partstudios/d/did/w/wid/e/eid/parts\n\n"
    );
    // The string must end with the query field followed by a newline, i.e.
    // its last two characters are '\n\n' when query === '' (query-then-\n,
    // preceded by the path's own \n) — this is exactly the trailing
    // newline the pre-fix join('\n') dropped.
    expect(got.endsWith("parts\n\n")).toBe(true);
  });

  it("signs a non-empty query string after the path, still trailing-newline terminated", () => {
    const got = buildOnshapeHmacString(
      "GET", "NONCE", "DATE", "application/json",
      "/api/documents/d/DID/externaldata/FID", "embedLinkType=EMBEDLINK",
    );
    expect(got).toBe(
      "get\nnonce\ndate\napplication/json\n/api/documents/d/did/externaldata/fid\nembedlinktype=embedlink\n"
    );
  });

  it("differs from the pre-fix (no-trailing-newline) construction", () => {
    const method = "POST", nonce = "n", date = "d", ct = "application/json", path = "/api/x";
    const got = buildOnshapeHmacString(method, nonce, date, ct, path, "");

    // The bug this test guards against: Array#join('\n') over
    // [method, nonce, date, ct, path, ''] yields "...path\n" with NO second
    // trailing '\n' — one byte short of the correct string.
    const buggy = [method.toLowerCase(), nonce, date, ct, path, ""].join("\n").toLowerCase();

    expect(got).not.toBe(buggy);
    expect(got).toBe(buggy + "\n");
  });
});

describe("buildOnshapeRequest Content-Type consistency (issue #277)", () => {
  const creds: OnshapeCredentials = { accessKey: "AK", secretKey: "SK" };

  it("sends the same Content-Type on GET as was used to compute the signature", () => {
    // buildOnshapeRequest is exported specifically so this can be checked
    // without a network call: re-derive the expected signature using the
    // Content-Type header actually returned, and confirm it matches.
    const { headers, url } = buildOnshapeRequest("GET", "/api/partstudios/d/DID/w/WID/e/EID/parts", creds);
    const sentCt = headers["Content-Type"];

    expect(sentCt).toBe("application/json");
    expect(url).toBe("https://cad.onshape.com/api/partstudios/d/DID/w/WID/e/EID/parts");

    // Re-derive the auth header using the Content-Type that was actually
    // sent, and confirm it reproduces the same signature buildOnshapeRequest
    // computed — i.e. the header sent is the header signed.
    const date  = headers["Date"]!;
    const nonce = headers["On-Nonce"]!;
    const hmacStr = buildOnshapeHmacString(
      "get", nonce, date, sentCt!, "/api/partstudios/d/DID/w/WID/e/EID/parts", "",
    );
    const expectedSig = crypto.createHmac("sha256", creds.secretKey).update(hmacStr).digest("base64");
    const expectedAuth = `On ${creds.accessKey}:HmacSHA256:${expectedSig}`;

    expect(headers["Authorization"]).toBe(expectedAuth);
  });

  it("sends the same Content-Type on POST as was used to compute the signature", () => {
    const body = JSON.stringify({ formatName: "STEP" });
    const { headers } = buildOnshapeRequest(
      "POST", "/api/partstudios/d/DID/w/WID/e/EID/translations", creds, body,
    );
    const sentCt = headers["Content-Type"];
    expect(sentCt).toBe("application/json");

    const date  = headers["Date"]!;
    const nonce = headers["On-Nonce"]!;
    const hmacStr = buildOnshapeHmacString(
      "post", nonce, date, sentCt!, "/api/partstudios/d/DID/w/WID/e/EID/translations", "",
    );
    const expectedSig = crypto.createHmac("sha256", creds.secretKey).update(hmacStr).digest("base64");
    const expectedAuth = `On ${creds.accessKey}:HmacSHA256:${expectedSig}`;

    expect(headers["Authorization"]).toBe(expectedAuth);
  });

  it("GET and POST sign an identical Content-Type value (no method-dependent mismatch)", () => {
    const get  = buildOnshapeRequest("GET",  "/api/partstudios/d/DID/w/WID/e/EID/parts", creds);
    const post = buildOnshapeRequest("POST", "/api/partstudios/d/DID/w/WID/e/EID/translations", creds, "{}");
    expect(get.headers["Content-Type"]).toBe(post.headers["Content-Type"]);
  });
});
