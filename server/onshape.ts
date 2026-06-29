/**
 * onshape.ts
 * ----------
 * Onshape REST API integration for StressForm.
 *
 * Allows fetching a Part Studio directly from Onshape by URL,
 * exporting it as STEP, and piping it into the analysis pipeline.
 *
 * Authentication: Onshape API key (access key + secret key)
 * from https://dev-portal.onshape.com/keys
 *
 * URL format:
 *   https://cad.onshape.com/documents/{did}/w/{wid}/e/{eid}
 *   https://cad.onshape.com/documents/{did}/v/{vid}/e/{eid}
 *
 * Relevant API endpoints:
 *   GET /partstudios/d/{did}/w/{wid}/e/{eid}/parts
 *   POST /partstudios/d/{did}/w/{wid}/e/{eid}/translations
 *   GET /translations/{tid}  (poll for completion)
 *   GET /documents/d/{did}/externaldata/{fid}  (download result)
 */

import crypto   from "crypto";
import https    from "https";
import { URL }  from "url";

export interface OnshapeCredentials {
  accessKey:  string;
  secretKey:  string;
}

export interface OnshapeDocumentRef {
  did:  string;   // document id
  wvm: "w" | "v" | "m";  // workspace / version / microversion
  wvmid: string;
  eid: string;    // element (Part Studio) id
}

/**
 * Parse an Onshape URL into its document/workspace/element components.
 *
 * Handles:
 *   https://cad.onshape.com/documents/{did}/w/{wid}/e/{eid}
 *   https://cad.onshape.com/documents/{did}/v/{vid}/e/{eid}
 */
export function parseOnshapeUrl(urlStr: string): OnshapeDocumentRef | null {
  try {
    const url = new URL(urlStr);
    if (!url.hostname.includes('onshape.com')) return null;

    // Match /documents/{did}/w/{wid}/e/{eid} or /v/ or /m/
    const m = url.pathname.match(
      /\/documents\/([a-f0-9]+)\/(w|v|m)\/([a-f0-9]+)\/e\/([a-f0-9]+)/i
    );
    if (!m) return null;

    return {
      did:   m[1]!,
      wvm:   m[2] as "w" | "v" | "m",
      wvmid: m[3]!,
      eid:   m[4]!,
    };
  } catch {
    return null;
  }
}

/**
 * Build an Onshape HMAC-signed request.
 * Uses APIKey authentication (not OAuth).
 */
function buildOnshapeRequest(
  method:  string,
  path:    string,
  creds:   OnshapeCredentials,
  body?:   string,
): { headers: Record<string, string>; url: string } {
  const date    = new Date().toUTCString();
  const nonce   = crypto.randomBytes(16).toString('hex');
  const ct      = body ? 'application/json' : '';
  const baseUrl = 'https://cad.onshape.com';

  // HMAC string: method\nnonce\ndate\ncontent-type\npath\n
  const hmacStr = [
    method.toLowerCase(),
    nonce,
    date,
    ct,
    path,
    '',
  ].join('\n').toLowerCase();

  const sig = crypto
    .createHmac('sha256', creds.secretKey)
    .update(hmacStr)
    .digest('base64');

  const auth = `On ${creds.accessKey}:HmacSHA256:${sig}`;

  return {
    url: baseUrl + path,
    headers: {
      'Authorization': auth,
      'Date':          date,
      'On-Nonce':      nonce,
      'Content-Type':  ct || 'application/json',
      'Accept':        'application/json',
    },
  };
}

/** Simple HTTPS fetch for Onshape API calls */
export async function onshapeFetch(
  method:  string,
  path:    string,
  creds:   OnshapeCredentials,
  body?:   object,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const { headers, url } = buildOnshapeRequest(method, path, creds, bodyStr);

    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method,
      headers:  { ...headers, ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: raw });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** Download binary from Onshape (for STEP file) */
async function onshapeDownloadBinary(
  path:  string,
  creds: OnshapeCredentials,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { headers, url } = buildOnshapeRequest('GET', path, creds);
    const parsed = new URL(url);

    const get = (urlStr: string, redirectCount = 0) => {
      if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }
      const u = new URL(urlStr);
      const opts = {
        hostname: u.hostname,
        path:     u.pathname + u.search,
        method:   'GET',
        headers:  u.hostname.includes('onshape.com') ? headers : {},
      };
      const req = https.request(opts, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location, redirectCount + 1);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.end();
    };
    get(url);
  });
}

/**
 * Export a Part Studio from Onshape as STEP.
 *
 * Flow:
 *  1. Start a translation job (POST /translations)
 *  2. Poll until complete (GET /translations/{tid})
 *  3. Download the result STEP buffer
 *
 * Returns the STEP file as a Buffer, or throws with a descriptive error.
 */
export async function exportPartStudioAsStep(
  ref:   OnshapeDocumentRef,
  creds: OnshapeCredentials,
  partId?: string,  // optional: export specific part; if omitted exports first part
): Promise<{ buffer: Buffer; fileName: string }> {

  // Step 1: Get parts list to find first part if not specified
  let resolvedPartId = partId;
  if (!resolvedPartId) {
    const partsPath = `/api/partstudios/d/${ref.did}/${ref.wvm}/${ref.wvmid}/e/${ref.eid}/parts`;
    const partsRes  = await onshapeFetch('GET', partsPath, creds);
    if (partsRes.status !== 200) {
      throw new Error(`Onshape parts list failed (${partsRes.status}). Check your API key and document URL.`);
    }
    const parts = partsRes.data as Array<{ partId: string; name: string }>;
    if (!parts.length) throw new Error('No parts found in this Part Studio.');
    resolvedPartId = parts[0]!.partId;
  }

  // Step 2: Start translation job
  const transPath = `/api/partstudios/d/${ref.did}/${ref.wvm}/${ref.wvmid}/e/${ref.eid}/translations`;
  const transBody = {
    formatName:    'STEP',
    partIds:       [resolvedPartId],
    storeInDocument: false,
    units:         'millimeter',
    version:       'AP214IS',
  };
  const transRes = await onshapeFetch('POST', transPath, creds, transBody);
  if (transRes.status !== 200 && transRes.status !== 201) {
    throw new Error(`Onshape translation start failed (${transRes.status}). Check document permissions.`);
  }
  const tid = (transRes.data as { id: string }).id;
  if (!tid) throw new Error('No translation ID returned.');

  // Step 3: Poll for completion (max 60s)
  const pollPath = `/api/translations/${tid}`;
  let pollRes: { status: number; data: unknown };
  const t0 = Date.now();
  while (true) {
    if (Date.now() - t0 > 60_000) throw new Error('Onshape export timed out after 60s.');
    await new Promise(r => setTimeout(r, 1500));
    pollRes = await onshapeFetch('GET', pollPath, creds);
    const state = (pollRes.data as { requestState?: string }).requestState;
    if (state === 'DONE') break;
    if (state === 'FAILED') throw new Error('Onshape translation failed — check document access.');
  }

  const resultExternalDataIds = (pollRes!.data as { resultExternalDataIds?: string[] }).resultExternalDataIds;
  if (!resultExternalDataIds?.length) throw new Error('No output file from Onshape export.');

  // Step 4: Download STEP file
  const fid        = resultExternalDataIds[0]!;
  const dlPath     = `/api/documents/d/${ref.did}/externaldata/${fid}`;
  const stepBuffer = await onshapeDownloadBinary(dlPath, creds);

  if (stepBuffer.length < 100) {
    throw new Error('Downloaded file is too small — likely an error response.');
  }

  const fileName = `onshape_part.step`;
  return { buffer: stepBuffer, fileName };
}
