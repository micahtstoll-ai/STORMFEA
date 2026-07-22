/**
 * index.ts
 * --------
 * STORMFEA local server. (Formerly branded "StressForm" — on-disk file names
 * and env vars keep the legacy stressform naming for backward compatibility.)
 * Runs on http://localhost:3000
 *
 * Routes:
 *   GET  /              → serves the UI (client/index.html)
 *   POST /api/upload    → parse STL, detect holes, return geometry data
 *   POST /api/analyse   → run FEM solve, return stress field + summary
 *   GET  /api/health    → confirm server is running
 */

import express       from "express";
import multer        from "multer";
import cors          from "cors";
import path          from "path";
import { fileURLToPath } from "url";
import { spawn }         from "child_process";
import { parseSTL }      from "./stl.js";
import { detectHoles, flagMergedHoleWarnings }   from "./holes.js";
import { runAnalysis, AnalysisAbortError }   from "./analysis.js";
import { MATERIALS, FDM_ORTHO_RATIOS, layerHeightFactor } from "./analysis.js";
import type { ForceSpec, PrintSettings, AnalysisSettings, AnalysisResult } from "./analysis.js";
import { expect as expectShape, ValidationError } from "./validate.js";
import type { Spec } from "./validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app    = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    const ext = (file.originalname as string).split('.').pop()?.toLowerCase() ?? '';
    if (['stl', 'step', 'stp'].includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type .${ext} — only STL and STEP accepted`));
  },
});

// Restrict CORS to localhost origins only — this is a local tool
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (same-origin, curl, Postman, start.bat browser open)
    // and any localhost/127.0.0.1 origin
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      cb(null, true);
    } else {
      cb(new Error('CORS: only localhost origins allowed'));
    }
  },
  credentials: false,
}));
app.use(express.json({ limit: "50mb" }));

// ── Request validation (issue #106) ───────────────────────────────────────────
// Every error response across all routes uses the uniform envelope
//   { error: string, field?: string, hint?: string }
// POST routes validate their body shape with validateBody() BEFORE any heavy
// work (base64 decode, meshing, solving), so a malformed request gets a 400
// with the offending field path instead of an opaque mid-pipeline 500.
function validateBody(req: express.Request, res: express.Response, spec: Spec): boolean {
  try {
    expectShape(req.body, spec);
    return true;
  } catch (e) {
    if (e instanceof ValidationError) {
      res.status(400).json({ error: e.message, field: e.field, hint: e.hint });
      return false;
    }
    throw e;
  }
}

// ── Serve the UI ──────────────────────────────────────────────────────────────
// STRESSFORM_CLIENT_DIR env var is set by Electron to point to the
// bundled client. Falls back to local dist/client for npm start usage.
// (The env var keeps the legacy "STRESSFORM" name so existing launchers keep
// working; the user-facing product name is STORMFEA.)
const clientDir = process.env["STRESSFORM_CLIENT_DIR"]
  ?? path.join(__dirname, "client");
app.use(express.static(clientDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "43" });
});

// ── Upload + parse STL or STEP ────────────────────────────────────────────────
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({
        error: "No file uploaded",
        field: "file",
        hint:  "send multipart/form-data with a 'file' part containing an .stl, .step or .stp file",
      });
      return;
    }

    const buffer   = req.file.buffer;
    const filename = (req.file.originalname ?? "").toLowerCase();
    const isStep   = filename.endsWith(".step") || filename.endsWith(".stp");

    if (isStep) {
      // STEP file: use Gmsh to get geometry info (quick 2D mesh for bounds/holes)
      const { meshStepWithGmsh } = await import("./gmsh_mesh.js");
      const gmsh = await meshStepWithGmsh(buffer, { clMin: 0.5, clMax: 4.0, clCurv: 15 });

      // Compute bounding box from mesh nodes
      const nodes = gmsh.mesh.nodes;
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
      for (let n=0;n<gmsh.mesh.nodeCount;n++){
        const x=nodes[n*3]??0,y=nodes[n*3+1]??0,z=nodes[n*3+2]??0;
        if(x<minX)minX=x;if(x>maxX)maxX=x;
        if(y<minY)minY=y;if(y>maxY)maxY=y;
        if(z<minZ)minZ=z;if(z>maxZ)maxZ=z;
      }

      // Build surface positions Float32Array from Gmsh surface triangles
      const surfTris  = gmsh.surfaceTriangles;
      const triCount  = surfTris.length / 3;
      const positions = new Float32Array(triCount * 9);
      for (let t=0;t<triCount;t++){
        for (let vi=0;vi<3;vi++){
          const n = surfTris[t*3+vi]??0;
          positions[t*9+vi*3]   = nodes[n*3]??0;
          positions[t*9+vi*3+1] = nodes[n*3+1]??0;
          positions[t*9+vi*3+2] = nodes[n*3+2]??0;
        }
      }

      // Build hole list from Gmsh's identified hole wall surfaces.
      // Use gmsh.holeRadius (the correctly-computed circle-fit radius from
      // identifySurfaces) rather than recomputing radius here — an earlier
      // version of this code recomputed it independently from raw wall-node
      // positions, which is what originally produced a ~4.5x-inflated
      // radius despite identifySurfaces itself being correct.
      const holes = Array.from(gmsh.holeWallNodes.entries()).map(([id, nodeIndices]) => {
        // Hole centre = mean of the wall-node positions on all three axes,
        // matching the Onshape import path below. The z component was
        // previously hardcoded to 2.0 (half a nominal 4 mm plate), which
        // skewed the constraint node search and edge-distance checks for any
        // STEP part thicker than 4 mm (issue #111).
        const xs = nodeIndices.map(n => nodes[n*3]??0);
        const ys = nodeIndices.map(n => nodes[n*3+1]??0);
        const zs = nodeIndices.map(n => nodes[n*3+2]??0);
        const cx = xs.reduce((a,b)=>a+b,0)/xs.length;
        const cy = ys.reduce((a,b)=>a+b,0)/ys.length;
        const cz = zs.reduce((a,b)=>a+b,0)/zs.length;
        const r = gmsh.holeRadius.get(id) ?? 0;
        return { id, centre:[cx,cy,cz] as [number,number,number],
          normal:[0,0,1] as [number,number,number],
          radius:+r.toFixed(4), diameter:+(r*2).toFixed(4),
          confidence:1.0, edgeCount:nodeIndices.length,
          warning: null as string | null };
      });

      // Flag overlapping (likely Gmsh-merged) hole detections so the user can
      // verify a possibly-wrong radius (README closely-spaced-holes caveat).
      const holeWarnings = flagMergedHoleWarnings(holes);
      holes.forEach((h, i) => {
        if (holeWarnings[i]) { h.warning = holeWarnings[i]; h.confidence = Math.min(h.confidence, 0.5); }
      });
      const nMerged = holeWarnings.filter(Boolean).length;
      console.log(`[upload] STEP ${req.file.originalname}: ${triCount} surface tris, ${holes.length} holes` +
        (nMerged ? ` (${nMerged} flagged as possibly merged)` : ""));

      res.json({
        fileType: "step",
        fileName: req.file.originalname,
        triangleCount: triCount,
        bounds: { minX, maxX, minY, maxY, minZ, maxZ },
        dimensions: { x:+(maxX-minX).toFixed(3), y:+(maxY-minY).toFixed(3), z:+(maxZ-minZ).toFixed(3) },
        holes,
        positionsB64: Buffer.from(positions.buffer).toString("base64"),
        stepB64: buffer.toString("base64"),
      });
    } else {
      // STL file: existing pipeline
      const stl = parseSTL(buffer);
      const p = stl.positions;
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
      for (let i=0;i<p.length;i+=3){
        const x=p[i]??0,y=p[i+1]??0,z=p[i+2]??0;
        if(x<minX)minX=x;if(x>maxX)maxX=x;
        if(y<minY)minY=y;if(y>maxY)maxY=y;
        if(z<minZ)minZ=z;if(z>maxZ)maxZ=z;
      }
      const holes = detectHoles(stl.positions, stl.triangleCount);
      console.log(`[upload] STL ${req.file.originalname}: ${stl.triangleCount} triangles, ${holes.length} holes`);
      res.json({
        fileType: "stl",
        fileName: req.file.originalname,
        triangleCount: stl.triangleCount,
        bounds: { minX, maxX, minY, maxY, minZ, maxZ },
        dimensions: { x:+(maxX-minX).toFixed(3), y:+(maxY-minY).toFixed(3), z:+(maxZ-minZ).toFixed(3) },
        holes: holes.map(h => ({
          id:h.id, centre:h.centre, normal:h.normal,
          radius:+h.radius.toFixed(4), diameter:+(h.radius*2).toFixed(4),
          confidence:+h.confidence.toFixed(3), edgeCount:h.edgeCount,
        })),
        positionsB64: Buffer.from(stl.positions.buffer).toString("base64"),
      });
    }
  } catch (err) {
    console.error("[upload error]", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Run FEM analysis ──────────────────────────────────────────────────────────
// Body shape checked BEFORE any decode/meshing/solve work — see validateBody().
const ANALYSE_SPEC: Spec = {
  positionsB64:     "string",
  "stepB64?":       "string",
  "fileType?":      "stl|step",
  triangleCount:    "number",
  bounds: {
    minX: "number", maxX: "number",
    minY: "number", maxY: "number",
    minZ: "number", maxZ: "number",
  },
  holes: [{
    id: "number", centre: "vec3", normal: "vec3", radius: "number",
    "confidence?": "number", "edgeCount?": "number",
    "rmsError?": "number", "maxDeviation?": "number",
  }],
  boltHoleIds: ["number"],
  "boltFasteners?": [{ holeId: "number", "fastenerType?": "string", "washerOD?": "number" }],
  forces: [{
    magnitude: "number", direction: "vec3", position: "vec3",
    "loadDistribution?": "uniform|cosine_bearing",
  }],
  print: {
    materialId: "string", infillPct: "number", wallCount: "number",
    pattern: "string", orientation: "string", layerHeightMm: "number",
    "extrusionWidthMm?": "number",
    // Optional solid top/bottom (floor/ceiling) skin layer counts — feed the
    // two-region model's independent skin bands (topLayers × layerHeight).
    "topLayers?": "number", "bottomLayers?": "number",
    // Optional process block — activates the bead-penetration bond model
    // (server/solver/bond.ts). Absent → legacy layer-height factor only.
    "process?": {
      "nozzleTempC?":   "number",
      "bedTempC?":      "number",
      "printSpeedMmS?": "number",
      "coolingFanPct?": "number",
      "ambientTempC?":  "number",
    },
  },
  "analysis?": {
    "meshQuality?":     "coarse|standard|fine",
    "meshOrder?":       "number",
    "analysisType?":    "string",
    "computeBuckling?": "boolean",
    "uncertaintyMode?": "string",
    "useCLT?":          "boolean",
    "beadProps?":       "object",
    "twoRegion?":       "boolean",
    "criterion?":       "fdm-interface|hill-legacy",
  },
  "gravity?":      { g: "number", direction: "vec3" },
  "pressures?":    [{ magnitude: "number", direction: "vec3", "normal?": "boolean", "region?": "face|facing|all" }],
  "fatigueLoadRatio?": "number",
  "layerNormal?":  "vec3",
  "calibration?":  "object",
};

app.post("/api/analyse", async (req, res) => {
  try {
    if (!validateBody(req, res, ANALYSE_SPEC)) return;

    // ANALYSE_SPEC only asserts materialId is a string — enforce the supported
    // SET here (issue #186) so an unknown id is refused up front rather than
    // silently falling back to PLA base/bond physics deep in the solver.
    const materialId = (req.body as { print?: { materialId?: unknown } })?.print?.materialId;
    if (typeof materialId !== "string" || !isKnownMaterial(materialId)) {
      res.status(400).json({
        error: `Unknown material "${String(materialId)}"`,
        field: "print.materialId",
        hint:  `must be one of: ${MATERIAL_IDS.join(", ")}`,
      });
      return;
    }

    const body = req.body as {
      positionsB64: string;
      stepB64?:     string;
      fileType:     "stl" | "step";
      triangleCount: number;
      bounds: { minX:number; maxX:number; minY:number; maxY:number; minZ:number; maxZ:number };
      holes: Array<{
        id: number;
        centre: [number,number,number];
        normal: [number,number,number];
        radius: number;
        confidence: number;
        edgeCount: number;
        rmsError?: number;
        maxDeviation?: number;
      }>;
      boltHoleIds: number[];
      forces: ForceSpec[];
      print: PrintSettings;
      analysis?: Partial<AnalysisSettings>;
    };

    // Decode positions
    const posBuf = Buffer.from(body.positionsB64, "base64");
    if (posBuf.byteLength === 0 || posBuf.byteLength % 4 !== 0) {
      res.status(400).json({
        error: "Invalid request: positionsB64 does not decode to a float32 array",
        field: "positionsB64",
        hint:  `decoded to ${posBuf.byteLength} bytes — expected a non-empty multiple of 4 (use the positionsB64 returned by /api/upload)`,
      });
      return;
    }
    const positions = new Float32Array(posBuf.buffer, posBuf.byteOffset, posBuf.byteLength / 4);

    // Decode STEP buffer if present
    const stepBuffer = body.stepB64 ? Buffer.from(body.stepB64, "base64") : undefined;

    const holes = body.holes.map(h => ({
      ...h,
      rmsError:     h.rmsError     ?? 0,
      maxDeviation: h.maxDeviation ?? 0,
    }));

    // Analysis settings — group the numerical-method knobs with defaults so a
    // partial (or omitted) `analysis` object still solves. This mirrors the
    // AnalysisSettings shape in analysis.ts; the print object stays part-only.
    const analysis: AnalysisSettings = {
      meshQuality:     (body.analysis?.meshQuality ?? "standard") as "coarse" | "standard" | "fine",
      meshOrder:       (body.analysis?.meshOrder === 1 ? 1 : 2),
      analysisType:    (body.analysis?.analysisType === "modal" ? "modal" : "linear_static"),
      computeBuckling: body.analysis?.computeBuckling === true,
      uncertaintyMode: (body.analysis?.uncertaintyMode ?? "central") as "central" | "conservative" | "optimistic",
      useCLT:          body.analysis?.useCLT === true,
      ...(body.analysis?.beadProps ? { beadProps: body.analysis.beadProps } : {}),
      twoRegion:       body.analysis?.twoRegion === true,
    };

    console.log(`[analyse] fileType=${body.fileType} bolts=[${body.boltHoleIds}] forces=${body.forces.length} mesh=${analysis.meshQuality}`);

    // ── Assemble runAnalysis arguments (shared by both response modes) ──────────
    const ANALYSE_TIMEOUT_MS = 120_000;
    const runArgs = {
      positions,
      stepBuffer,
      fileType:      (body.fileType ?? "stl") as "stl" | "step",
      triangleCount: body.triangleCount,
      bounds:        body.bounds,
      holes,
      boltHoleIds:   body.boltHoleIds,
      ...(((body as any).boltFasteners) ? { boltFasteners: (body as any).boltFasteners } : {}),
      forces:        body.forces,
      print:         body.print,
      analysis,
      // gravity is validated by ANALYSE_SPEC ({ g:number, direction:vec3 }) when
      // present, so it can be passed through directly.
      ...((body as any).gravity
        ? { gravity: (body as any).gravity as { g: number; direction: [number, number, number] } }
        : {}),
      ...(Array.isArray((body as any).pressures)
        ? { pressures: (body as any).pressures as { magnitude: number; direction: [number, number, number]; normal?: boolean; region?: "face" | "facing" | "all" }[] }
        : {}),
      ...(typeof (body as any).fatigueLoadRatio === "number"
        ? { fatigueLoadRatio: (body as any).fatigueLoadRatio as number }
        : {}),
      ...(Array.isArray((body as any).layerNormal)
        ? { layerNormal: (body as any).layerNormal as [number, number, number] }
        : {}),
    };

    // Build the full JSON response payload from a completed analysis. Shared by
    // the blocking JSON path (res.json) and the SSE "result" event (issue #109).
    const buildPayload = (result: AnalysisResult) => ({
      summary: {
        maxVonMisesMPa:       +result.maxVonMisesMPa.toFixed(4),
        maxDisplacementMm:    +result.maxDisplacementMm.toFixed(6),
        effectiveYieldMPa:    +result.effectiveYieldMPa.toFixed(2),
        safetyFactor:         result.safetyFactor !== null ? +result.safetyFactor.toFixed(3) : null,
        sfCriterion:          result.sfCriterion,
        vonMisesSafetyFactor: result.vonMisesSafetyFactor !== null ? +result.vonMisesSafetyFactor.toFixed(3) : null,
        safetyfactorLow:      result.safetyfactorLow,
        safetyFactorHigh:     result.safetyFactorHigh,
        estimatedFailForce:   +result.estimatedFailForce.toFixed(1),
        surfaceTriangleCount: result.surfaceTriangleCount,
        yielding:             result.yielding,
        verdict:              result.verdict,
        cgIterations:         result.cgIterations,
        converged:            result.converged,
        meshFallback:         result.meshFallback,
        unitsWarning:         result.unitsWarning,
        materialModel:        result.materialModel,
        solverMs:             result.solverMs,
        nodeCount:            result.nodeCount,
        elementCount:         result.elementCount,
        nodesPerElem:         result.nodesPerElem,
        recommendations:      result.recommendations,
        failureModes:         result.failureModes,
        holeClassifications:  result.holeClassifications,
        calibrationId:        result.calibrationId,
        singularity:          result.singularity,
        rigidBodyMode:        result.rigidBodyMode,
        topologySuggestions:  result.topologySuggestions,
        layerInterfaceProfile: result.layerInterfaceProfile ?? null,
        couponRecommendations: result.couponRecommendations ?? [],
        delaminationDFM:      result.delaminationDFM ?? null,
        fatigue:              result.fatigue,
        isotropicComparison:  result.isotropicComparison,
        governingDirection:   result.governingDirection ?? null,
        peakUtilXY:           result.peakUtilXY ?? null,
        peakUtilZ:            result.peakUtilZ  ?? null,
        minSignedVonMisesMPa: result.minSignedVonMisesMPa,
        maxSignedVonMisesMPa: result.maxSignedVonMisesMPa,
        boltReactions:        (result as any).boltReactions ?? [],
        residualCheckpoints:  result.residualCheckpoints ?? [],
      },
      vertexStressB64:              Buffer.from(result.vertexStress.buffer).toString("base64"),
      vertexSignedVonMisesB64:      Buffer.from(result.vertexSignedVonMises.buffer).toString("base64"),
      vertexXyUtilB64:           result.vertexXyUtil ? Buffer.from(result.vertexXyUtil.buffer).toString("base64") : null,
      vertexZUtilB64:            result.vertexZUtil  ? Buffer.from(result.vertexZUtil.buffer).toString("base64")  : null,
      vertexPrincipalStressB64:  Buffer.from(result.vertexPrincipalStress.buffer).toString("base64"),
      vertexPrincipalStress2B64: Buffer.from(result.vertexPrincipalStress2.buffer).toString("base64"),
      vertexPrincipalStress3B64: Buffer.from(result.vertexPrincipalStress3.buffer).toString("base64"),
      vertexDisplacementB64:    Buffer.from(result.vertexDisplacement.buffer).toString("base64"),
      vertexErrorEstimateB64:   result.vertexErrorEstimateB64 ?? null,
      globalRelativeError:      result.globalRelativeError ?? null,
      topErrorElements:         result.topErrorElements ?? null,
      vertexModeShapesB64:      result.vertexModeShapesB64 ?? null,
      modalResult:              result.modalResult ? {
        modalMs:            result.modalResult.modalMs,
        converged:          result.modalResult.converged,
        iterations:         result.modalResult.iterations,
        rigidBodyModeCount: result.modalResult.rigidBodyModeCount,
        certified:          result.modalResult.certified,          // #160
        warnings:           result.modalResult.warnings ?? [],     // #160
        totalMassX:         result.modalResult.totalMassX,         // #161
        totalMassY:         result.modalResult.totalMassY,
        totalMassZ:         result.modalResult.totalMassZ,
        modes: result.modalResult.modes.map(m => ({
          frequencyHz:         m.frequencyHz,
          omega2:              m.omega2,
          participationFactor: m.participationFactor,               // legacy (= X)
          participationX:      m.participationX,                    // #161
          participationY:      m.participationY,
          participationZ:      m.participationZ,
          effectiveMassX:      m.effectiveMassX,
          effectiveMassY:      m.effectiveMassY,
          effectiveMassZ:      m.effectiveMassZ,
          cumulativeMassFracX: m.cumulativeMassFracX,
          cumulativeMassFracY: m.cumulativeMassFracY,
          cumulativeMassFracZ: m.cumulativeMassFracZ,
          rigid:               m.rigid,                             // #160.4
          residual:            m.residual,                         // #160.2
          // modeShape excluded — transmitted via vertexModeShapesB64
        })),
      } : null,
    });

    // ── SSE streaming mode (issue #109) ────────────────────────────────────────
    // Opt-in via ?stream=1 or Accept: text/event-stream. Emits ordered phase
    // events (mesh → constraints → assembly → solve → recovery → mapping), shows
    // mesh size the moment meshing completes, streams CG residual checkpoints,
    // and wires the request 'close' event to an AbortSignal — so closing the tab
    // or clicking Cancel stops the server-side solve at the next phase boundary
    // instead of burning full CPU on an abandoned result. The blocking JSON path
    // below is unchanged, so existing callers and integration tests still work.
    const wantsSSE = req.query["stream"] === "1"
      || (req.headers.accept ?? "").includes("text/event-stream");

    if (wantsSSE) {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");   // disable proxy buffering
      res.flushHeaders?.();

      const ac = new AbortController();
      let aborted = false;
      const abort = (why: string): void => {
        if (aborted) return;
        aborted = true;
        ac.abort();
        console.log(`[analyse:sse] ${why} — aborting solve`);
      };
      // Detect a real client disconnect via the RESPONSE 'close' event, not
      // req 'close': in Node 18+ the request stream emits 'close' as soon as its
      // body has been fully consumed (which express.json already did), which
      // would fire a false abort immediately. res 'close' only fires when the
      // connection actually goes away; if that happens before we res.end(), the
      // client is gone (tab closed / Cancel) and we abort the solve.
      res.on("close", () => { if (!res.writableEnded) abort("client disconnected"); });
      const timeoutId = setTimeout(
        () => abort(`timed out after ${ANALYSE_TIMEOUT_MS / 1000}s`),
        ANALYSE_TIMEOUT_MS,
      );

      const sse = (event: string, data: unknown): void => {
        if (res.writableEnded) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const result = await runAnalysis({
          ...runArgs,
          signal:  ac.signal,
          onPhase: (ev) => sse("phase", ev),
        });
        clearTimeout(timeoutId);
        console.log(`[analyse:sse] done in ${result.solverMs}ms: maxVM=${result.maxVonMisesMPa.toFixed(2)}MPa converged=${result.converged}`);
        sse("result", buildPayload(result));
        if (!res.writableEnded) res.end();
      } catch (err) {
        clearTimeout(timeoutId);
        if (aborted || err instanceof AnalysisAbortError || (err as { name?: string })?.name === "AnalysisAbortError") {
          console.log("[analyse:sse] solve aborted before completion — no result sent");
          if (!res.writableEnded) res.end();
          return;
        }
        console.error("[analyse:sse error]", err);
        const msg  = err instanceof Error ? err.message : String(err);
        const hint = err instanceof TetGenNotFoundError ? err.hint : undefined;
        sse("error", { error: msg, ...(hint ? { hint } : {}) });
        if (!res.writableEnded) res.end();
      }
      return;
    }

    // ── Blocking JSON mode (default; backward compatible) ───────────────────────
    // runAnalysis is synchronous/CPU-bound for the PCG solve, so Promise.race
    // cannot interrupt it mid-loop. The real hang-prevention is the 5 000-
    // iteration cap in cg.ts; this timeout catches the async parts (TetGen/Gmsh
    // subprocess calls, file I/O) so a stalled binary yields an error response
    // instead of an open connection.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(
        `Solver timed out after ${ANALYSE_TIMEOUT_MS / 1000}s. ` +
        `TetGen or Gmsh may be unresponsive — check that both binaries are on PATH.`
      )), ANALYSE_TIMEOUT_MS)
    );

    const result = await Promise.race([ runAnalysis(runArgs), timeoutPromise ]);
    console.log(`[analyse] done in ${result.solverMs}ms: maxVM=${result.maxVonMisesMPa.toFixed(2)}MPa SF=${result.safetyFactor !== null ? result.safetyFactor.toFixed(2) : '(unavailable)'} converged=${result.converged}`);
    res.json(buildPayload(result));

  } catch (err) {
    console.error("[analyse error]", err);
    if (err instanceof TetGenNotFoundError) {
      // Environment problem, not a geometry or request problem: the mesher
      // binary is absent. 503 = "service (meshing) unavailable"; the hint
      // carries platform-specific install instructions (issue #106).
      res.status(503).json({ error: err.message, hint: err.hint });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Coupon STL download ───────────────────────────────────────────────────────
import {
  generateTensileCoupon,
  generateZTensileCoupon,
  generateLapShearCoupon,
  generateBearingCoupon,
} from "./coupon_stl.js";
import { generateDemoPart, DEMO_ARCHETYPE_META, generateDemoBracket, DEMO_BRACKET } from "./demo_part.js";

// Serves the sample bracket for the one-click demo scenario. Same STL path a
// user upload takes, so the demo exercises the real pipeline (hole detection,
// meshing, solve) rather than a faked result.
app.get("/api/demo/part", (req, res) => {
  const type = (req.query["type"] as string) || "bracket";
  const meta = DEMO_ARCHETYPE_META[type as keyof typeof DEMO_ARCHETYPE_META]
    ?? DEMO_ARCHETYPE_META["bracket"]!;
  const buf = generateDemoPart(type as any);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${meta.fileName}"`);
  res.setHeader("X-Demo-Dims", JSON.stringify(DEMO_BRACKET));
  res.setHeader("X-Demo-Meta", JSON.stringify(meta));
  res.send(buf);
});

// GET /api/demo/archetypes — return available part archetypes for the picker
app.get("/api/demo/archetypes", (_req, res) => {
  res.json(DEMO_ARCHETYPE_META);
});

app.get("/api/calibration/coupon/:type", (req, res) => {
  const type = req.params["type"];
  let buf: Buffer;
  let filename: string;

  try {
    switch (type) {
      case "tensile":
        buf = generateTensileCoupon();
        filename = "stressform_tensile_coupon.stl";
        break;
      case "ztensile":
        buf = generateZTensileCoupon();
        filename = "stressform_ztensile_coupon.stl";
        break;
      case "lapshear":
        buf = generateLapShearCoupon();
        filename = "stressform_lapshear_coupon.stl";
        break;
      case "bearing":
        buf = generateBearingCoupon();
        filename = "stressform_bearing_coupon.stl";
        break;
      default:
        res.status(400).json({ error: "Unknown coupon type" }); return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Calibration endpoints ─────────────────────────────────────────────────────
import {
  backCalculateProfile,
  fitFatigueProfile,
  FATIGUE_LOGRMS_MAX,
  COUPON_DIMS,
  isKnownMaterial,
  MATERIAL_IDS,
} from "./analysis.js";
import type { CalibrationProfile, FatigueCouponPoint } from "./analysis.js";
import fs   from "fs";
import os   from "os";

// Store calibration profiles in a JSON file in user's home directory.
// (File name keeps the legacy "stressform" prefix — the tool's user-facing
// name is STORMFEA, but renaming the on-disk stores would orphan every
// existing user's saved data. Same applies to the other ~/.stressform_*
// paths below and the STRESSFORM_CLIENT_DIR env var above.)
const CALIB_PATH = path.join(os.homedir(), ".stressform_calibrations.json");

/**
 * Atomic write for the user-data stores (issue #111): write to `path + ".tmp"`
 * then rename over the target. rename() is atomic on the same filesystem, so
 * a crash mid-write leaves the previous store intact instead of a truncated,
 * unparseable JSON file (which the loaders would silently treat as empty —
 * losing the team's calibration/validation history). `mode` restricts
 * permissions on the temp file BEFORE it becomes visible at the target path
 * (used for the Onshape credentials file).
 */
function writeFileAtomic(filePath: string, data: string, mode?: number): void {
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, data, "utf-8");
  if (mode !== undefined) {
    try { fs.chmodSync(tmpPath, mode); } catch { /* windows: no-op */ }
  }
  fs.renameSync(tmpPath, filePath);
}

function loadProfiles(): CalibrationProfile[] {
  try {
    if (fs.existsSync(CALIB_PATH)) {
      return JSON.parse(fs.readFileSync(CALIB_PATH, "utf-8"));
    }
  } catch { /* ignore parse errors */ }
  return [];
}

function saveProfiles(profiles: CalibrationProfile[]): void {
  writeFileAtomic(CALIB_PATH, JSON.stringify(profiles, null, 2));
}

// GET /api/calibration — list all profiles + coupon dimensions
app.get("/api/calibration", (_req, res) => {
  res.json({ profiles: loadProfiles(), couponDims: COUPON_DIMS });
});

// POST /api/calibration/calculate — back-calculate profile from coupon results
app.post("/api/calibration/calculate", (req, res) => {
  try {
    if (!validateBody(req, res, {
      id: "string", label: "string", materialId: "string", layerHeightMm: "number",
      // Coupon loads are nullable-by-design (null = coupon not tested), which
      // the checker treats as absent — so they are declared optional here.
      "tensileFailN?": "number", "lapShearFailN?": "number",
      "bearingFailN?": "number", "tensileDeflMm?": "number",
      "zTensileFailN?": "number",
      "ktLapShear?": "number", "ktBearing?": "number",
    })) return;
    const profile = backCalculateProfile(req.body);
    res.json({ profile });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// POST /api/calibration/fatigue — fit an S-N (Basquin) curve from cyclic coupon
// points, returning the fatigue calibration fields to merge into a profile.
// This is the fatigue analogue of /calibration/calculate: real cyclic-test data
// replaces the literature Se/UTS + Basquin b, and lifts fatigue LOW→MEDIUM.
app.post("/api/calibration/fatigue", (req, res) => {
  try {
    const body = req.body as {
      materialId?: string;
      utsMPa?: number;
      enduranceLifeCycles?: number;
      points?: FatigueCouponPoint[];
    };
    if (!Array.isArray(body.points) || body.points.length < 2) {
      res.status(400).json({
        error: "Need at least 2 fatigue coupon points",
        field: "points",
        hint:  "send points: [{ stressAmplitudeMPa, cycles }, …] with ≥2 entries at distinct cycle counts",
      });
      return;
    }
    const uts = typeof body.utsMPa === "number" && body.utsMPa > 0 ? body.utsMPa : 55;
    const fit = fitFatigueProfile(body.points, uts, body.enduranceLifeCycles ?? 1e6);
    // Residual gate (issue #179), keep-LOW decision: accept the fit either way —
    // cyclic-coupon scatter is physically inherent, so a team's own noisy S-N
    // data is still their best available. A POOR fit is carried into the profile
    // as fatigueFitQuality:"poor", which keeps estimateFatigue at LOW confidence
    // (it still USES the measured Se/b). Clean fits behave exactly as before
    // (LOW→MEDIUM). logRms is always returned so even good fits show their
    // evidence.
    res.json({
      fit,   // includes logRms + fitQuality
      fitQuality: fit.fitQuality,
      fatigueFields: {
        fatigueSeRatio:    +fit.seRatio.toFixed(4),
        fatigueBasquinB:   +fit.basquinB.toFixed(4),
        fatigueUTS_MPa:    uts,
        fatigueFitQuality: fit.fitQuality,
      },
      ...(fit.fitQuality === "poor" ? {
        warning: `S-N fit quality is POOR: log-log residual ${fit.logRms.toFixed(3)} exceeds the ${FATIGUE_LOGRMS_MAX} bound (~±${(Math.expm1(FATIGUE_LOGRMS_MAX) * 100).toFixed(0)}% amplitude scatter). The fields are accepted — your coupons are the best data — but the fatigue mode stays LOW confidence. Re-check for outliers or mixed test conditions.`,
      } : {}),
    });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// POST /api/calibration/bond-sweep — fit the bead-penetration bond model's
// coefficients {hConv, activationEnergyKJmol, strengthPrefactor} to a process
// sweep of Z-tension coupons printed at varied nozzle temp / speed / fan /
// layer height. The returned bondCoeffs merge into a profile (like the
// fatigue fit) and lift the bond model LOW→MEDIUM confidence.
app.post("/api/calibration/bond-sweep", async (req, res) => {
  try {
    if (!validateBody(req, res, {
      materialId: "string",
      "yieldXY_MPa?": "number",
      "yieldZ_over_yieldXY?": "number",
      points: [{
        layerHeightMm: "number",
        "measuredSztMPa?": "number",
        "zTensileFailN?":  "number",
        "nozzleTempC?": "number", "printSpeedMmS?": "number",
        "coolingFanPct?": "number", "bedTempC?": "number", "ambientTempC?": "number",
      }],
    })) return;
    const { fitBondCoeffs, layerHeightFactor, literatureYieldMPa, literatureYieldZRatio, COUPON_DIMS: CD } =
      await import("./analysis.js");
    const { isKnownBondMaterial } = await import("./solver/bond.js");
    const body = req.body as {
      materialId: string;
      yieldXY_MPa?: number;
      yieldZ_over_yieldXY?: number;
      points: Array<Record<string, number | undefined>>;
    };
    // Refuse unknown materials (issue #186): fitting against PLA's reference
    // physics would return coefficients calibrated to the wrong material.
    if (!isKnownBondMaterial(body.materialId)) {
      res.status(400).json({
        error: `Unknown material "${body.materialId}" — no bond property table entry`,
        field: "materialId",
      });
      return;
    }
    // Accept either a directly measured strength or the raw coupon failure
    // load (converted with the Z-tension gauge area, same as backCalculate).
    const areaZ = CD.zTensile.gaugeWidthMm * CD.zTensile.gaugeThickMm;
    const points = body.points.map(p => ({
      layerHeightMm:  p["layerHeightMm"]!,
      nozzleTempC:    p["nozzleTempC"],
      printSpeedMmS:  p["printSpeedMmS"],
      coolingFanPct:  p["coolingFanPct"],
      bedTempC:       p["bedTempC"],
      ambientTempC:   p["ambientTempC"],
      measuredSztMPa: p["measuredSztMPa"] ?? ((p["zTensileFailN"] ?? 0) / areaZ),
    }));
    if (points.some(p => !(p.measuredSztMPa > 0))) {
      res.status(400).json({
        error: "Every sweep point needs measuredSztMPa or zTensileFailN > 0",
        field: "points",
      });
      return;
    }
    const { BOND_FIT_RMSE_MAX_PCT } = await import("./solver/bond.js");
    const yieldXY = body.yieldXY_MPa ?? literatureYieldMPa(body.materialId);
    const yZRatio = body.yieldZ_over_yieldXY ?? literatureYieldZRatio();
    const fit = fitBondCoeffs(body.materialId, points, yieldXY, yZRatio, layerHeightFactor);
    // Residual gate (issue #179), reject decision: bond coefficients are applied
    // MULTIPLICATIVELY to interlayer strength/stiffness in every later analysis
    // that carries process settings, and their presence lifts bond confidence
    // LOW→MEDIUM. A fit the physical model cannot reproduce would silently
    // corrupt all of those, so refuse it (400) and name the worst datum rather
    // than hand back numbers the fit itself says are wrong. The legacy
    // literature-constants path (no bondCoeffs) remains the honest default.
    if (fit.fitQuality === "poor") {
      const w = fit.worstPoint;
      res.status(400).json({
        error: `Bond sweep fit quality too poor to accept: RMS error ${fit.rmsePct.toFixed(1)}% of mean measured strength exceeds the ${BOND_FIT_RMSE_MAX_PCT}% bound. The bead-penetration model cannot reproduce this data — check for a mislabeled point, mixed filament, or a bad measurement, then re-fit.`,
        field: "points",
        rmsePct: +fit.rmsePct.toFixed(2),
        thresholdPct: BOND_FIT_RMSE_MAX_PCT,
        fitQuality: "poor",
        worstPoint: {
          index: w.index, measuredMPa: +w.measuredMPa.toFixed(3),
          predictedMPa: +w.predictedMPa.toFixed(3), deviationPct: +w.deviationPct.toFixed(1),
        },
        points: fit.points.map(p => ({
          index: p.index, measuredMPa: +p.measuredMPa.toFixed(3),
          predictedMPa: +p.predictedMPa.toFixed(3), deviationPct: +p.deviationPct.toFixed(1),
        })),
      });
      return;
    }
    // Good fit: return the evidence (rmsePct + per-point residuals live on `fit`).
    res.json({ fit, fitQuality: fit.fitQuality, bondFields: { bondCoeffs: fit.coeffs } });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// POST /api/bond-sensitivity — process-parameter sensitivity sweeps (#2) and a
// nozzle×speed bond-quality surface (#4) for the bead-penetration bond model.
// Pure evaluation of predictBondMultipliers — no solve, no physics duplicated
// in the client. "strengthFactor" is the FULL multiplier the material builder
// applies to the interlayer allowable S_zt: layerHeightFactor(lh) × bond
// relStrength, so it reads as "interlayer strength vs the in-plane baseline".
app.post("/api/bond-sensitivity", async (req, res) => {
  try {
    if (!validateBody(req, res, { materialId: "string", layerHeightMm: "number" })) return;
    const { predictBondMultipliers, BOND_MATERIALS, BOND_REFERENCE } = await import("./solver/bond.js");
    const { layerHeightFactor } = await import("./analysis.js");
    const body = req.body as {
      materialId: string; layerHeightMm: number;
      process?: { nozzleTempC?: number; printSpeedMmS?: number; coolingFanPct?: number; bedTempC?: number; ambientTempC?: number };
      bondCoeffs?: { hConv?: number; activationEnergyKJmol?: number; strengthPrefactor?: number } | null;
    };
    // Refuse unknown materials (issue #186) rather than silently graph PLA bond
    // physics under another material's name.
    if (!(body.materialId in BOND_MATERIALS)) {
      res.status(400).json({
        error: `Unknown material "${body.materialId}" — no bond property table entry`,
        field: "materialId",
        hint:  `must be one of: ${Object.keys(BOND_MATERIALS).join(", ")}`,
      });
      return;
    }
    const matKey = body.materialId;
    const matRef = BOND_MATERIALS[matKey]!;
    const lh = body.layerHeightMm > 1e-6 ? body.layerHeightMm : 0.2;
    const coeffs = body.bondCoeffs ?? null;
    const proc = body.process ?? {};
    // Baseline = the caller's actual settings; defaults filled from the material
    // reference so an empty process block sits exactly at the reference
    // condition (relStrength = 1.0), matching predictBondMultipliers internally.
    const base = {
      nozzleTempC:   proc.nozzleTempC   ?? matRef.nozzleRefC,
      printSpeedMmS: proc.printSpeedMmS ?? BOND_REFERENCE.printSpeedMmS,
      coolingFanPct: proc.coolingFanPct ?? BOND_REFERENCE.coolingFanPct,
      bedTempC:      proc.bedTempC      ?? BOND_REFERENCE.bedTempC,
      ambientTempC:  proc.ambientTempC  ?? BOND_REFERENCE.ambientTempC,
    };
    type Override = Partial<typeof base> & { layerHeightMm?: number };
    const evalAt = (over: Override) => {
      const l = over.layerHeightMm ?? lh;
      const p = predictBondMultipliers(matKey, l, { ...base, ...over }, coeffs);
      return { relStrength: p.relStrength, relStiffness: p.relStiffness, strengthFactor: layerHeightFactor(l) * p.relStrength };
    };
    const b = predictBondMultipliers(matKey, lh, base, coeffs);
    const baseline = {
      ...base, layerHeightMm: lh,
      relStrength:  +b.relStrength.toFixed(4),
      relStiffness: +b.relStiffness.toFixed(4),
      strengthFactor: +(layerHeightFactor(lh) * b.relStrength).toFixed(4),
      confidence: b.confidence, clamped: b.clamped, note: b.note,
    };

    const linspace = (a: number, c: number, n: number) => Array.from({ length: n }, (_, i) => a + (c - a) * i / (n - 1));
    const sweep = (values: number[], make: (v: number) => Override) => values.map(v => {
      const r = evalAt(make(v));
      return { value: +v.toFixed(3), relStrength: +r.relStrength.toFixed(4), strengthFactor: +r.strengthFactor.toFixed(4) };
    });

    const nozzleVals = linspace(Math.max(matRef.TgC + 30, matRef.nozzleRefC - 50), matRef.nozzleRefC + 40, 15);
    const speedVals  = linspace(5, 150, 15);
    const fanVals    = linspace(0, 100, 11);
    const lhVals     = linspace(0.05, 0.4, 15);

    const sweeps = {
      nozzleTempC:   { unit: "°C",   label: "Nozzle temperature", baseValue: base.nozzleTempC,   points: sweep(nozzleVals, v => ({ nozzleTempC: v })) },
      printSpeedMmS: { unit: "mm/s", label: "Print speed",        baseValue: base.printSpeedMmS, points: sweep(speedVals,  v => ({ printSpeedMmS: v })) },
      coolingFanPct: { unit: "%",    label: "Cooling fan",        baseValue: base.coolingFanPct, points: sweep(fanVals,    v => ({ coolingFanPct: v })) },
      layerHeightMm: { unit: "mm",   label: "Layer height",       baseValue: lh,                 points: sweep(lhVals,     v => ({ layerHeightMm: v })) },
    };

    // Bond-quality surface (#4): nozzle × speed grid of bond relStrength.
    const grid = speedVals.map(sp => nozzleVals.map(nz => +evalAt({ nozzleTempC: nz, printSpeedMmS: sp }).relStrength.toFixed(4)));
    const surface = {
      xKey: "nozzleTempC",   xUnit: "°C",   xLabel: "Nozzle temperature", xValues: nozzleVals.map(v => +v.toFixed(1)),
      yKey: "printSpeedMmS", yUnit: "mm/s", yLabel: "Print speed",        yValues: speedVals.map(v => +v.toFixed(1)),
      grid, baseX: base.nozzleTempC, baseY: base.printSpeedMmS, valueLabel: "Bond strength ×",
    };

    res.json({
      materialId: matKey, layerHeightMm: lh,
      reference: { nozzleTempC: matRef.nozzleRefC, ...BOND_REFERENCE },
      baseline, sweeps, surface,
    });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// POST /api/calibration/save — save a calibrated profile
app.post("/api/calibration/save", (req, res) => {
  try {
    if (!validateBody(req, res, { id: "string", materialId: "string" })) return;
    const profile = req.body as CalibrationProfile;
    const profiles = loadProfiles().filter(p => p.id !== profile.id);
    profiles.push(profile);
    saveProfiles(profiles);
    res.json({ saved: true, profileCount: profiles.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// DELETE /api/calibration/:id — delete a profile
app.delete("/api/calibration/:id", (req, res) => {
  const profiles = loadProfiles().filter(p => p.id !== req.params["id"]);
  saveProfiles(profiles);
  res.json({ deleted: true });
});

// GET /api/calibration/export-all — download every saved profile as one file.
// Lets a team move all calibration/Taguchi profiles between machines (laptop
// <-> PC) without re-entering coupon data by hand on each one.
app.get("/api/calibration/export-all", (_req, res) => {
  try {
    const profiles = loadProfiles();
    const bundle = {
      version:     "1.0",
      exportedAt:  new Date().toISOString(),
      tool:        "STORMFEA calibration export — Nordic Storm FTC 5962",
      profileCount: profiles.length,
      profiles,
    };
    const json = JSON.stringify(bundle, null, 2);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition",
      `attachment; filename="stressform_calibrations_${Date.now()}.json"`);
    res.send(json);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/calibration/import-all — merge profiles from an exported bundle
// into the local ~/.stressform_calibrations.json. Profiles are matched by id:
// an imported profile with the same id as an existing one overwrites it
// (treat the import as "the source of truth for these ids"); profiles with
// new ids are added alongside whatever is already saved locally. This means
// importing is safe to run repeatedly and never silently drops a profile
// that exists locally but wasn't part of the import.
app.post("/api/calibration/import-all", (req, res) => {
  try {
    if (!validateBody(req, res, { profiles: ["object"] })) return;
    const incoming = (req.body as { profiles: unknown[] }).profiles;

    // Validate each incoming profile has the minimum required fields before
    // accepting it. Malformed entries are skipped (and reported) rather than
    // silently corrupting the local profile list or crashing the import.
    const valid: CalibrationProfile[] = [];
    const skipped: string[] = [];
    for (const p of incoming) {
      const profile = p as Partial<CalibrationProfile>;
      if (profile && typeof profile.id === "string" && typeof profile.materialId === "string") {
        valid.push(profile as CalibrationProfile);
      } else {
        skipped.push(JSON.stringify(p).slice(0, 80));
      }
    }

    const existing = loadProfiles();
    const incomingIds = new Set(valid.map(p => p.id));
    const merged = [...existing.filter(p => !incomingIds.has(p.id)), ...valid];
    saveProfiles(merged);

    res.json({
      imported:     valid.length,
      skipped:      skipped.length,
      skippedSamples: skipped,
      totalProfiles: merged.length,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Validation scoreboard endpoints ───────────────────────────────────────────
import { computeStats, deriveCase } from "./validation.js";
import type { ValidationCase } from "./validation.js";

const VALIDATION_PATH = path.join(os.homedir(), ".stressform_validations.json");

function loadValidations(): ValidationCase[] {
  try {
    if (fs.existsSync(VALIDATION_PATH)) {
      return JSON.parse(fs.readFileSync(VALIDATION_PATH, "utf-8"));
    }
  } catch { /* ignore parse errors */ }
  return [];
}

function saveValidations(cases: ValidationCase[]): void {
  writeFileAtomic(VALIDATION_PATH, JSON.stringify(cases, null, 2));
}

// GET /api/validation — all cases (each with derived fields) + aggregate stats
app.get("/api/validation", (_req, res) => {
  const cases = loadValidations();
  res.json({
    cases: cases.map(c => ({ ...c, derived: deriveCase(c) })),
    stats: computeStats(cases),
  });
});

// POST /api/validation/save — add or update a validation case
app.post("/api/validation/save", (req, res) => {
  try {
    if (!validateBody(req, res, {
      id: "string", predictedFailN: "number", measuredFailN: "number",
    })) return;
    const c = req.body as ValidationCase;
    if (!(c.measuredFailN > 0) || !(c.predictedFailN > 0)) {
      res.status(400).json({
        error: "Invalid request: predictedFailN and measuredFailN must be positive",
        field: c.predictedFailN > 0 ? "measuredFailN" : "predictedFailN",
        hint:  "enter the failure load in newtons (must be > 0)",
      });
      return;
    }
    const cases = loadValidations().filter(v => v.id !== c.id);
    cases.push(c);
    saveValidations(cases);
    res.json({ saved: true, count: cases.length, derived: deriveCase(c), stats: computeStats(cases) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// DELETE /api/validation/:id — remove a case
app.delete("/api/validation/:id", (req, res) => {
  const cases = loadValidations().filter(v => v.id !== req.params["id"]);
  saveValidations(cases);
  res.json({ deleted: true, stats: computeStats(cases) });
});


// ── Solver validation suite ───────────────────────────────────────────────────
// Runs solver_validation.js as a child process and streams structured results
// back as JSON. Results are parsed from stdout line-by-line.
// The validation script uses console.log (✓/✗) — we parse those markers.

app.get("/api/solver-tests", async (_req, res) => {
  const distTestPath = path.join(__dirname, "tests", "solver_validation.js");

  if (!fs.existsSync(distTestPath)) {
    res.status(404).json({
      error: "Validation suite not compiled. Run: npm run build",
      tests: [],
    });
    return;
  }

  const groups: { name: string; tests: { name: string; passed: boolean; detail?: string }[] }[] = [];
  let currentGroup: (typeof groups)[0] | null = null;
  let passed = 0, failed = 0;
  const lines: string[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [distTestPath], {
        cwd: __dirname,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      });

      const processLine = (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        lines.push(line);

        // Group header: "[1] Patch test — ..."
        const groupMatch = line.match(/^\[(\d+)\]\s+(.+)/);
        if (groupMatch && groupMatch[2]) {
          currentGroup = { name: groupMatch[2], tests: [] };
          groups.push(currentGroup);
          return;
        }

        // Pass: "  ✓ Test name"  or "  PASS Test name" (compiled JS may vary)
        const passMatch = line.match(/^\s*[✓✔]\s+(.+)/);
        if (passMatch && passMatch[1] && currentGroup) {
          currentGroup.tests.push({ name: passMatch[1], passed: true });
          passed++;
          return;
        }

        // Fail: "  ✗ Test name: detail"
        const failMatch = line.match(/^\s*[✗✘×]\s+(.+?)(?::\s*(.+))?$/);
        if (failMatch && failMatch[1] && currentGroup) {
          currentGroup.tests.push({ name: failMatch[1], passed: false, detail: failMatch[2] });
          failed++;
          return;
        }
      };

      let stdoutBuf = '', stderrBuf = '';

      child.stdout?.on('data', (d: Buffer) => {
        stdoutBuf += d.toString();
        const parts = stdoutBuf.split('\n');
        stdoutBuf = parts.pop() ?? '';
        parts.forEach(processLine);
      });

      child.stderr?.on('data', (d: Buffer) => {
        stderrBuf += d.toString();
        // stderr also contains ✗ failures from console.error
        const parts = stderrBuf.split('\n');
        stderrBuf = parts.pop() ?? '';
        parts.forEach(processLine);
      });

      child.on('close', (code) => {
        if (stdoutBuf) processLine(stdoutBuf);
        if (stderrBuf) processLine(stderrBuf);
        resolve();
      });

      child.on('error', reject);
    });
  } catch (e) {
    res.status(500).json({ error: String(e), tests: [], groups: [] });
    return;
  }

  res.json({ passed, failed, total: passed + failed, groups, rawLines: lines });
});


// POST /api/calibration/kt — run FEA on standard coupon geometry to extract Kt
// Uses solveCouponKt from coupon_fea.ts to compute stress concentration factors
// for lap-shear and bearing coupons, given material and layer height.
app.post("/api/calibration/kt", async (req, res) => {
  try {
    if (!validateBody(req, res, { materialId: "string", "layerHeightMm?": "number" })) return;
    const { materialId, layerHeightMm = 0.2 } = req.body as {
      materialId: string;
      layerHeightMm?: number;
    };

    const { solveCouponKt, buildBearingKtProbe } = await import("./coupon_fea.js");
    const { backCalculateProfile } = await import("./analysis.js");

    // Build a representative material profile from literature defaults
    const profile = backCalculateProfile({
      id: "kt-probe", label: "kt-probe", materialId, layerHeightMm,
      tensileFailN: null, lapShearFailN: 1600, bearingFailN: 2400, tensileDeflMm: null,
    });

    // Approximate material for solver
    const p_ = profile as any;
    const mat = {
      kind: "orthotropic" as const,
      E_xy:    p_.E_xy_MPa   ?? 3500,
      E_z:     p_.E_z_MPa    ?? (p_.E_xy_MPa ? p_.E_xy_MPa * 0.65 : 2275),
      nu_xy:   p_.nu_xy      ?? 0.36,
      nu_xz:   p_.nu_xz      ?? 0.30,
      G_xz:    p_.G_xz_MPa  ?? ((p_.E_xy_MPa ?? 3500) * 0.4 / (2 * (1 + 0.36))),
      yieldXY: p_.yieldXY_MPa ?? 50,
      yieldZ:  p_.yieldZ_MPa  ?? 29,
      label: materialId,
    };

    // Lap-shear: POLICY Kt ≡ 1.0 — the calibrated allowable is the APPARENT
    // (average) interlaminar shear strength F/A_overlap, by design (issue #140).
    // Two reasons this is correct, not a shortcut:
    //   1. The end-of-overlap shear peak in a single-lap joint is a geometric
    //      SINGULARITY (re-entrant corner): any FEA "Kt" there just tracks mesh
    //      density and never converges, so a peak-based lap-shear allowable
    //      would be false precision.
    //   2. STORMFEA evaluates part interlaminar shear on element-AVERAGED stress
    //      (fdmDualCriterion S_zs), so an average-based allowable is the
    //      consistent measure. The previous plain-box probe returned Kt ≈ 1
    //      anyway — this makes the ≡1 explicit and honest rather than incidental.
    const ktLapShear = 1.0;

    // Bearing: plate-with-hole fixture at COUPON_DIMS.bearing geometry, loaded in
    // far-field tension (the only load the fixture supports). Kt is the
    // net-section OPEN-HOLE tension SCF used as a first-order proxy for the
    // bearing concentration — see buildBearingKtProbe (issue #139). Replaces the
    // old hole-less bar whose Kt ≈ 1 made this correction a silent no-op.
    const bearingProbe = buildBearingKtProbe(COUPON_DIMS.bearing);
    const ktBear = await solveCouponKt(bearingProbe.mesh, mat, bearingProbe.loadCase);

    res.json({
      ktLapShear,
      ktBearing:  ktBear.converged ? ktBear.Kt : null,
      converged:  ktBear.converged,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});


// ── Engineering methodology document ─────────────────────────────────────────
// GET /api/methodology — returns a self-contained 2-page HTML document suitable
// for printing as PDF and including in an FTC engineering notebook.
// No analysis result required — documents the solver methodology statically.

app.get("/api/methodology", (_req, res) => {
  // Material table + layer-height figures are GENERATED from the live solver
  // constants (issue #199) so they can never drift from the code: adding a
  // material to MATERIALS or re-tuning layerHeightFactor updates this document
  // with no hand edit.
  const materialRows = Object.values(MATERIALS).map(m => {
    const yieldZ = m.yieldMPa * FDM_ORTHO_RATIOS.yieldZ_over_yieldXY;
    return `  <tr><td>${m.label}</td><td>${m.E}</td><td>${m.nu.toFixed(2)}</td>` +
           `<td>${m.yieldMPa}</td><td>${yieldZ.toFixed(1)}</td></tr>`;
  }).join("\n");

  // Layer-height correction, derived by evaluating layerHeightFactor at known
  // points: slope from two in-range samples, clamp bounds from samples past the
  // clamp, and worked examples at 0.28 / 0.12 mm.
  const asPct = (f: number) => `${f >= 1 ? "+" : "−"}${Math.abs(Math.round((f - 1) * 100))}%`;
  const lhSlope = (layerHeightFactor(0.15) - layerHeightFactor(0.25)) / (0.25 - 0.15);
  const lhFloor = layerHeightFactor(0.50);   // past the low clamp
  const lhCeil  = layerHeightFactor(0.05);   // past the high clamp
  const lhAt028 = layerHeightFactor(0.28);
  const lhAt012 = layerHeightFactor(0.12);
  const layerHeightNote =
    `Layer-height correction to yield_Z (0.2 mm baseline): the multiplier follows a slope of ` +
    `−${lhSlope.toFixed(1)} per mm about the reference — thicker layers weaken inter-layer bonds, ` +
    `thinner layers strengthen them (Farashi &amp; Vafaee 2022 meta-analysis) — clamped to ` +
    `[${lhFloor.toFixed(2)}, ${lhCeil.toFixed(2)}] (${asPct(lhFloor)} / ${asPct(lhCeil)}). ` +
    `Worked examples: a 0.28 mm layer gives ${lhAt028.toFixed(2)}× (${asPct(lhAt028)}); ` +
    `a 0.12 mm layer gives ${lhAt012.toFixed(2)}× (${asPct(lhAt012)}).`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>STORMFEA — Engineering Methodology</title>
<style>
  @page { size: letter; margin: 18mm 20mm 18mm 20mm; }
  @media print {
    .page-break { page-break-before: always; }
    body { font-size: 9.5pt; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 10pt;
    color: #1a1a1a;
    line-height: 1.5;
    background: #fff;
  }
  /* Header */
  .doc-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    border-bottom: 2.5px solid #C9A227;
    padding-bottom: 10px;
    margin-bottom: 18px;
  }
  .doc-title {
    font-size: 18pt;
    font-weight: 700;
    letter-spacing: .04em;
    color: #C9A227;
    line-height: 1;
    margin-bottom: 3px;
  }
  .doc-subtitle {
    font-size: 9pt;
    color: #555;
    letter-spacing: .04em;
  }
  .doc-meta {
    text-align: right;
    font-size: 8.5pt;
    color: #666;
    line-height: 1.7;
  }
  /* Section */
  h2 {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: #C9A227;
    border-bottom: 1px solid #e8d98a;
    padding-bottom: 3px;
    margin: 14px 0 7px;
  }
  h3 {
    font-size: 9.5pt;
    font-weight: 700;
    color: #222;
    margin: 10px 0 4px;
  }
  p { margin-bottom: 6px; }
  /* Two-column layout */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
  /* Cards */
  .card {
    border: 1px solid #e0e0e0;
    border-radius: 3px;
    padding: 8px 10px;
    background: #fafafa;
  }
  .card-title {
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #888;
    margin-bottom: 5px;
  }
  /* Tables */
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 9pt; }
  th { background: #f5f0e0; padding: 4px 7px; text-align: left; font-size: 8pt;
       font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #666;
       border-bottom: 1.5px solid #C9A227; }
  td { padding: 4px 7px; border-bottom: 1px solid #eee; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  /* Math */
  .eq {
    font-family: 'Courier New', monospace;
    background: #f8f5ea;
    border: 1px solid #e8d98a;
    border-radius: 2px;
    padding: 5px 10px;
    margin: 5px 0;
    font-size: 9pt;
  }
  /* Badges */
  .badge {
    display: inline-block;
    font-size: 7.5pt;
    font-weight: 700;
    letter-spacing: .08em;
    border: 1px solid;
    border-radius: 2px;
    padding: 1px 5px;
    vertical-align: middle;
  }
  .badge-pass { color: #1a7a40; border-color: #1a7a40; background: #edf7f1; }
  .badge-med  { color: #7a5a00; border-color: #C9A227; background: #fdf9ed; }
  .gold { color: #C9A227; }
  .muted { color: #666; font-size: 9pt; }
  ul { margin: 4px 0 6px 16px; }
  li { margin-bottom: 2px; }
  .footnote { font-size: 8pt; color: #888; border-top: 1px solid #e0e0e0; margin-top: 14px; padding-top: 8px; }
  .footer { display: flex; justify-content: space-between; font-size: 8pt; color: #aaa; margin-top: 14px; border-top: 1px solid #e0e0e0; padding-top: 6px; }
</style>
</head>
<body>

<!-- ═══════════════════ PAGE 1 ═══════════════════ -->
<div class="doc-header">
  <div>
    <div class="doc-title">STORMFEA</div>
    <div class="doc-subtitle">FDM-Aware Finite Element Analysis — Engineering Methodology</div>
    <div class="doc-subtitle" style="margin-top:2px">Nordic Storm · FTC Team 5962 · St. Peter, MN · BIOBUZZ 2026–2027</div>
  </div>
  <div class="doc-meta">
    Author: Micah Stoll<br>
    Version: 2.0<br>
    Date: ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}<br>
    Classification: Engineering Award Submission
  </div>
</div>

<h2>Problem Statement</h2>
<p>
  Standard FEA tools assume isotropic materials — equal strength in all directions. FDM-printed parts
  are not isotropic: layer boundaries are weak planes, and through-layer strength is typically 42–58%
  of in-layer strength. A part that appears safe in SolidWorks Simulation or ANSYS may actually fail
  at its layer boundaries under real FTC loads. STORMFEA is a custom FEA solver built to model this
  anisotropy explicitly using the FDM dual failure criterion — bulk (bead) von Mises yield plus a
  separate interlayer-interface (delamination) check.
</p>

<div class="two-col">
<div>
<h2>Solver Architecture</h2>
<h3>Mesh Generation</h3>
<p>
  Parts are meshed using <strong>TetGen</strong> (STL input) or <strong>Gmsh</strong> (STEP input)
  to produce tetrahedral meshes. The solver uses <strong>C3D10 10-node quadratic tetrahedra</strong>
  (second-order elements) which eliminate shear locking and capture bending and stress concentration
  behaviour that first-order C3D4 elements miss.
</p>

<h3>Constitutive Model</h3>
<p>
  FDM parts are modelled as <strong>transversely isotropic</strong> (orthotropic with one plane of
  symmetry). The stiffness matrix uses five independent constants:
</p>
<div class="eq">E_xy = in-layer modulus      E_z = through-layer modulus
G_xz = out-of-plane shear mod  ν_xy, ν_xz = Poisson ratios</div>
<p>Property ratios derived from peer-reviewed measurements (see References):</p>
<table>
  <tr><th>Ratio</th><th>Value</th><th>Source</th></tr>
  <tr><td>E_z / E_xy</td><td>0.65</td><td>Perez et al. 2021</td></tr>
  <tr><td>yield_Z / yield_XY</td><td>0.58</td><td>Cojocaru et al. 2019</td></tr>
  <tr><td>G_xz / G_xy</td><td>0.40</td><td>Ahn et al. 2002</td></tr>
  <tr><td>ν_xz</td><td>0.30</td><td>Casavola et al. 2016</td></tr>
</table>
</div>

<div>
<h2>Failure Criterion</h2>
<h3>FDM Dual Criterion</h3>
<p>
  A single quadratic (Hill) form cannot be rotationally symmetric about the layer normal while also
  matching a polymer's measured in-plane shear yield, so STORMFEA separates the two physical
  mechanisms and takes the governing minimum, both evaluated in the material (layer) frame:
</p>
<div class="eq">BULK  (bead yield):     SF_bulk = Y / σ_vm        (plain von Mises, azimuth-invariant)
INTERFACE (delamination): σ_zz&gt;0: U=√[(σ_zz/S_zt)²+(τ_z/S_zs)²], SF_int=1/U
                          σ_zz≤0: Mohr–Coulomb friction credit
SF = min(SF_bulk, SF_int)</div>
<p>
  with τ_z=√(τ_yz²+τ_xz²), S_zt=yield_Z (through-layer tension) and S_zs=interlaminar shear
  (default yield_Z/√3, μ=0.3). The interface normal term is <strong>tension-only</strong> — layers do
  not delaminate in compression. At the isotropic anchor (S_zt=Y, S_zs=Y/√3) the criterion reproduces
  von Mises exactly. The critical case for FTC parts is flat-print loading: when a force is applied
  perpendicular to the layer plane, σ_zz opens the interface and a part that looks safe under von
  Mises fails at SF ≈ 0.58 (= Z/Y). The legacy Hill (1948) quadratic remains available for comparison
  and as the upright-with-no-bed fallback.
</p>

<h3>Orientation Derivation</h3>
<p>
  Print orientation is derived geometrically from the build-plate face selection and applied force
  directions. The angle between the force vector and the layer normal determines whether the loading
  is flat (worst), upright (best), or angled (intermediate). This replaces the manual dropdown
  used in conventional tools.
</p>
</div>
</div>

<div class="two-col" style="margin-top:4px">
<div>
<h2>Material Database</h2>
<table>
  <tr><th>Material</th><th>E_xy (MPa)</th><th>ν</th><th>Yield XY (MPa)</th><th>Yield Z (MPa)</th></tr>
${materialRows}
</table>
<p class="muted">
  ${layerHeightNote}
</p>
</div>
<div>
<h2>Infill Correction</h2>
<table>
  <tr><th>Infill %</th><th>Strength multiplier</th></tr>
  <tr><td>100%</td><td>1.00×</td></tr>
  <tr><td>80%</td><td>0.94×</td></tr>
  <tr><td>60%</td><td>0.84×</td></tr>
  <tr><td>40%</td><td>0.71×</td></tr>
  <tr><td>20%</td><td>0.52×</td></tr>
</table>
<p class="muted">
  Gyroid pattern reduces strength degradation by ~6% vs rectilinear at equivalent infill.
  Concentric pattern increases shell contribution. Values from Birosz et al. 2022.
</p>
</div>
</div>

<div class="footer">
  <span>STORMFEA Engineering Methodology — Nordic Storm FTC Team 5962</span>
  <span>Page 1 of 2</span>
</div>

<!-- ═══════════════════ PAGE 2 ═══════════════════ -->
<div class="page-break"></div>

<div class="doc-header">
  <div>
    <div class="doc-title">STORMFEA</div>
    <div class="doc-subtitle">FDM-Aware Finite Element Analysis — Validation &amp; Calibration</div>
  </div>
  <div class="doc-meta">
    Nordic Storm · FTC Team 5962<br>
    ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}
  </div>
</div>

<h2>Solver Validation</h2>
<p>
  STORMFEA includes a 117-test automated validation suite run against problems with known analytical
  solutions. All tests must pass before a release is packaged. Results can be reproduced live from
  the DEBUG tab in the application.
</p>

<div class="three-col">
<div class="card">
  <div class="card-title">Test Group 1–2</div>
  <strong>Patch test &amp; cantilever beam</strong><br>
  <span class="muted">Uniform body force must produce Von Mises in physical range. Cantilever tip deflection must match Euler-Bernoulli within expected C3D10 tolerance (30–100% of E-B). Linear scaling verified: 2× load → 2× deflection.</span>
</div>
<div class="card">
  <div class="card-title">Test Groups 3–5</div>
  <strong>Constitutive matrix &amp; element</strong><br>
  <span class="muted">Orthotropic matrix must reduce to isotropic von Mises when Y_z = Y_xy (max diff &lt; 1e-6). C3D10 shape functions verified as partition of unity. Stiffness matrix Ke must be symmetric (max asymmetry &lt; 1e-8) and positive-definite.</span>
</div>
<div class="card">
  <div class="card-title">Test Groups 7–8</div>
  <strong>Failure criterion &amp; Kt calibration</strong><br>
  <span class="muted">The FDM dual criterion must reproduce von Mises at the isotropic limit and stay azimuth-invariant about the weak axis. In-plane uniaxial must yield exactly at Y_xy. False-safety case (flat print, through-layer load) must detect SF ≈ 0.58 — the core engineering claim. Uniform coupon bar must give Kt ≈ 1.0 ± 8% noise floor.</span>
</div>
</div>

<h2>Printer Calibration</h2>
<p>
  Literature values carry <span class="badge badge-med">MEDIUM</span> confidence. STORMFEA supports
  FEA-in-the-loop calibration: the user prints standard coupons (tensile dog-bone, Z-tension dog-bone,
  lap-shear, bearing plate) on their actual printer with their actual filament and settings, measures
  failure loads with a force gauge, and enters results. The solver back-calculates true material
  properties and upgrades confidence to <span class="badge badge-pass">HIGH</span>. Cyclic and process
  sweeps additionally fit the fatigue S-N curve and the bead-penetration bond model.
</p>

<div class="two-col">
<div>
<h3>Calibration Coupons</h3>
<table>
  <tr><th>Coupon</th><th>Measures</th><th>Derivation</th></tr>
  <tr><td>Tensile dog-bone</td><td>yield_XY, E_xy</td><td>F/A at fracture; stress/strain at yield</td></tr>
  <tr><td>Z-tension dog-bone</td><td>yield_Z = S_zt</td><td>same gauge printed standing on end; F/A in pure opening</td></tr>
  <tr><td>Lap-shear plate</td><td>S_zs (interlaminar shear)</td><td>F/(w×l) → shear allowable, independent of S_zt</td></tr>
  <tr><td>Bearing plate</td><td>Bearing strength</td><td>F/(d×t) corrected by Kt from FEA</td></tr>
</table>

<h3>Stress Concentration Correction</h3>
<p>
  The <strong>bearing</strong> coupon concentrates stress at the hole bore, so its nominal F/(d×t)
  understates the peak. STORMFEA runs FEA on a plate-with-hole model of the coupon to extract the
  net-section open-hole Kt (stress concentration factor) and lifts the derived bearing strength by
  that factor — a first-order proxy, since the fixture applies far-field tension rather than a bolt
  bearing on the wall. This removes the non-conservatism of mixing nominal-stress calibration with
  peak-stress part analysis.
</p>
<p>
  The <strong>lap-shear</strong> allowable is reported as the apparent (average) shear strength
  F/(w×l), i.e. Kt ≡ 1 by design: the end-of-overlap shear peak is a geometric singularity that does
  not converge under mesh refinement, and parts are checked on element-averaged interlaminar shear —
  so an average-based allowable is the consistent measure, not a peak-corrected one.
</p>
</div>
<div>
<h3>Stress Mapping</h3>
<p>
  FEA produces nodal stress at interior mesh nodes. Mapping to the surface render mesh uses a 3D
  spatial grid with nearest-node lookup (radius 3 mm), replacing the 2D XY-projection approach
  that incorrectly projected through part thickness. Surface stress is smoothed using a
  position-based vertex weld (ε = 0.1 μm) that correctly handles unindexed STL geometry.
</p>

<h3>Failure Mode Coverage</h3>
<ul>
  <li>Von Mises yield (isotropic reference)</li>
  <li>FDM dual criterion — bulk bead yield, governing for flat-printed parts</li>
  <li>Interlayer tension (delamination onset, ⟨σ_zz⟩₊ vs S_zt)</li>
  <li>Interlayer shear (τ_z vs S_zs, friction-credited in compression)</li>
  <li>Bearing failure at bolt holes</li>
  <li>Fatigue estimate (Goodman diagram, PLA S-N data)</li>
  <li>Stress singularity detection at sharp corners</li>
  <li>Topology optimization suggestions</li>
</ul>
</div>
</div>

<h2>References</h2>
<table>
  <tr><th>#</th><th>Citation</th></tr>
  <tr><td>1</td><td>Ahn S-H et al. Anisotropic material properties of fused deposition modeling ABS. Rapid Prototyping Journal. 2002;8(4):248–257.</td></tr>
  <tr><td>2</td><td>Casavola C et al. Orthotropic mechanical properties of FDM parts described by classical laminate theory. Materials &amp; Design. 2016;90:453–458.</td></tr>
  <tr><td>3</td><td>Perez DB, Celik E, Karkkainen RL. Investigation of interlayer interface strength in FDM 3D-printed PLA. 3D Printing and Additive Manufacturing. 2021;8(1).</td></tr>
  <tr><td>4</td><td>Cojocaru V et al. Analysis of anisotropy for 3D printed PLA parts. UPB Sci Bull Series B. 2019;81(4).</td></tr>
  <tr><td>5</td><td>Rodriguez JF, Thomas JP, Renaud JE. Mechanical behavior of ABS fused deposition materials. Rapid Prototyping Journal. 2001;7(3):148–158.</td></tr>
  <tr><td>6</td><td>Birosz MT, Ledenyák D, Andó M. Effect of FDM infill patterns on mechanical properties. Polymer Testing. 2022;113:107654.</td></tr>
  <tr><td>7</td><td>Farashi S, Vafaee F. Effect of printing parameters on tensile strength of FDM samples — meta-analysis. Progress in Additive Manufacturing. 2022;7:565–582.</td></tr>
  <tr><td>8</td><td>Hill R. A theory of the yielding and plastic flow of anisotropic metals. Proc R Soc London Ser A. 1948;193:281–297.</td></tr>
</table>

<div class="footer">
  <span>STORMFEA Engineering Methodology — Nordic Storm FTC Team 5962</span>
  <span>Page 2 of 2</span>
</div>

</body>
</html>`;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// ── Session persistence ───────────────────────────────────────────────────────
const SESSION_PATH = path.join(os.homedir(), ".stressform_session.json");

app.get("/api/session", (_req, res) => {
  try {
    if (fs.existsSync(SESSION_PATH)) {
      const data = fs.readFileSync(SESSION_PATH, "utf-8");
      res.json(JSON.parse(data));
    } else {
      res.json(null);
    }
  } catch { res.json(null); }
});

app.post("/api/session", (req, res) => {
  try {
    // Session payload is intentionally free-form client state — only require
    // that it IS an object, so a corrupted request can't store e.g. `null`.
    if (!validateBody(req, res, "object")) return;
    writeFileAtomic(SESSION_PATH, JSON.stringify(req.body));
    res.json({ saved: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.delete("/api/session", (_req, res) => {
  try {
    if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH);
    res.json({ cleared: true });
  } catch { res.json({ cleared: true }); }
});


// ── Session zip export ────────────────────────────────────────────────────────
// Bundles session metadata + calibration profile + HTML report into a zip.
// Uses native Node.js zlib (no external dep needed).
import { createGzip } from "zlib";
import { pipeline }   from "stream/promises";

app.post("/api/export-zip", async (req, res) => {
  try {
    if (!validateBody(req, res, {
      "session?": "object", "reportHtml?": "string", "calibProfile?": "object",
    })) return;
    const { session, reportHtml, calibProfile } = req.body;

    // Build a simple .tar-like bundle as JSON (judges just need the data)
    // True zip would require a dep — we'll send a structured JSON bundle instead
    const bundle = {
      version:    "1.0",
      exportedAt: new Date().toISOString(),
      tool:       "STORMFEA — Nordic Storm FTC 5962",
      session:    session ?? null,
      calibrationProfile: calibProfile ?? null,
      // HTML report embedded as base64
      reportHtmlB64: reportHtml ? Buffer.from(reportHtml).toString("base64") : null,
    };

    const json = JSON.stringify(bundle, null, 2);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition",
      `attachment; filename="stressform_export_${Date.now()}.json"`);
    res.send(json);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── HTML Report endpoint ──────────────────────────────────────────────────────
import { generateHtmlReport } from "./report.js";

app.post("/api/report", async (req, res) => {
  try {
    if (!validateBody(req, res, {
      result: "object", "fileName?": "string",
      "printSettings?": "object", "timestamp?": "string",
    })) return;
    const { result, fileName, printSettings, timestamp } = req.body;
    const html = generateHtmlReport(result, fileName || "part", printSettings || {}, timestamp || new Date().toLocaleString());
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── PDF export: removed server-side route ─────────────────────────────────────
// The old /api/report-pdf route rendered the /api/report HTML through
// headless Chromium via Puppeteer to produce real PDF bytes. That dependency
// was removed: Puppeteer's Chromium download reliably failed on locked-down
// school networks and even on a fresh Windows install with normal internet
// (npm install would hang/fail entirely trying to fetch ~150MB of Chromium),
// for a feature the app no longer needs server-side at all.
//
// PDF export now happens entirely client-side via exportFullReportPDF() in
// client/index.html, using a hand-rolled ~100-line PDF generator that embeds
// JPEG-rendered canvas pages directly (PDF's DCTDecode filter accepts raw
// JPEG bytes with no re-encoding needed). No server round-trip, no Chromium,
// no network dependency at all — see that function's comments for the full
// rationale and how it was verified (qpdf validation + visual round-trip).

// ── Onshape integration ───────────────────────────────────────────────────────
import {
  parseOnshapeUrl,
  exportPartStudioAsStep,
  onshapeFetch,
} from "./onshape.js";
import type { OnshapeCredentials } from "./onshape.js";

const ONSHAPE_CREDS_PATH = path.join(os.homedir(), ".stressform_onshape.json");

function loadOnshapeCreds(): OnshapeCredentials | null {
  try {
    if (fs.existsSync(ONSHAPE_CREDS_PATH)) {
      return JSON.parse(fs.readFileSync(ONSHAPE_CREDS_PATH, "utf-8"));
    }
  } catch {}
  return null;
}

// GET /api/onshape/status — check if credentials are configured
app.get("/api/onshape/status", (_req, res) => {
  const creds = loadOnshapeCreds();
  res.json({ configured: creds !== null });
});

// POST /api/onshape/credentials — save API key
app.post("/api/onshape/credentials", (req, res) => {
  if (!validateBody(req, res, { accessKey: "string", secretKey: "string" })) return;
  const { accessKey, secretKey } = req.body;
  if (!accessKey || !secretKey) {
    res.status(400).json({
      error: "Invalid request: accessKey and secretKey must be non-empty",
      field: accessKey ? "secretKey" : "accessKey",
      hint:  "copy both keys from dev-portal.onshape.com/keys",
    });
    return;
  }
  try {
    // Atomic write (issue #111); 0o600 is applied to the temp file before the
    // rename so the credentials are never world-readable, even transiently.
    writeFileAtomic(ONSHAPE_CREDS_PATH, JSON.stringify({ accessKey, secretKey }), 0o600);
    // Restrict credentials file to owner-only.
    // On POSIX (macOS/Linux): chmod 600 works natively.
    // On Windows: chmod is a no-op, so use icacls to strip inherited ACEs and
    // grant read+write to the current user only. If icacls fails, warn loudly
    // rather than silently leaving the file world-readable.
    if (process.platform === "win32") {
      const username = os.userInfo().username;
      const child = spawn("icacls", [
        ONSHAPE_CREDS_PATH,
        "/inheritance:r",
        `/grant:r`, `${username}:(R,W)`,
      ], { windowsHide: true });
      child.on("error", () => {
        console.warn(
          "[credentials] icacls not available — credentials file may be readable by other " +
          "users on this machine. Consider manually restricting: " + ONSHAPE_CREDS_PATH
        );
      });
      child.on("close", (code) => {
        if (code !== 0) {
          console.warn(
            `[credentials] icacls exited with code ${code} — file permissions may not be ` +
            `restricted. Path: ${ONSHAPE_CREDS_PATH}`
          );
        }
      });
    } else {
      try {
        fs.chmodSync(ONSHAPE_CREDS_PATH, 0o600);
      } catch (e) {
        console.warn("[credentials] chmod 600 failed:", e);
      }
    }
    res.json({ saved: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/onshape/parts — list parts in a Part Studio
app.post("/api/onshape/parts", async (req, res) => {
  const creds = loadOnshapeCreds();
  if (!creds) { res.status(401).json({ error: "Onshape not configured" }); return; }

  if (!validateBody(req, res, { url: "string" })) return;
  const { url: urlStr } = req.body;
  const ref = parseOnshapeUrl(urlStr);
  if (!ref) {
    res.status(400).json({
      error: "Invalid Onshape URL",
      field: "url",
      hint:  "expected https://cad.onshape.com/documents/{did}/w/{wid}/e/{eid}",
    });
    return;
  }

  try {
    // Reuse the same signed-request path as exportPartStudioAsStep — the
    // HMAC signing lives in one place (onshape.ts) so it can't drift.
    const partsPath = `/api/partstudios/d/${ref.did}/${ref.wvm}/${ref.wvmid}/e/${ref.eid}/parts`;
    const partsRes  = await onshapeFetch("GET", partsPath, creds);

    if (partsRes.status !== 200) {
      res.status(partsRes.status === 401 || partsRes.status === 403 ? 401 : 502).json({
        error: `Onshape parts list failed (HTTP ${partsRes.status}). Check your API key and that you have access to this document.`,
      });
      return;
    }

    const data  = partsRes.data;
    const parts = Array.isArray(data)
      ? (data as Array<{ partId: string; name: string }>)
      : [];

    res.json({ parts: parts.map(p => ({ partId: p.partId, name: p.name })) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/onshape/import — import STEP from Onshape URL
app.post("/api/onshape/import", async (req, res) => {
  const creds = loadOnshapeCreds();
  if (!creds) {
    res.status(401).json({ error: "Onshape API key not configured. Go to SETUP → Onshape to add your key." });
    return;
  }

  if (!validateBody(req, res, { url: "string", "partId?": "string" })) return;
  const { url: urlStr, partId } = req.body;

  const ref = parseOnshapeUrl(urlStr);
  if (!ref) {
    res.status(400).json({
      error: "Could not parse Onshape URL",
      field: "url",
      hint:  "expected https://cad.onshape.com/documents/{did}/w/{wid}/e/{eid}",
    });
    return;
  }

  try {
    console.log(`[onshape] importing from did=${ref.did} eid=${ref.eid}`);
    const { buffer, fileName } = await exportPartStudioAsStep(ref, creds, partId || undefined);
    console.log(`[onshape] got ${buffer.length} bytes STEP`);

    // Process through the same pipeline as a manual STEP upload
    const { parseSTL }    = await import("./stl.js");
    const { detectHoles } = await import("./holes.js");
    const { meshStepWithGmsh } = await import("./gmsh_mesh.js");

    // Get surface geometry and holes from Gmsh
    const gmshResult = await meshStepWithGmsh(buffer, {});
    const mesh       = gmshResult.mesh;

    // Build surface positions for display (same as upload route)
    const surfTris = gmshResult.surfaceTriangles;
    const positions = new Float32Array(surfTris.length * 3);
    for (let i = 0; i < surfTris.length; i++) {
      const n = surfTris[i] ?? 0;
      positions[i * 3]     = mesh.nodes[n * 3]     ?? 0;
      positions[i * 3 + 1] = mesh.nodes[n * 3 + 1] ?? 0;
      positions[i * 3 + 2] = mesh.nodes[n * 3 + 2] ?? 0;
    }
    const triCount = positions.length / 9;

    // Bounding box
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for (let i=0;i<positions.length;i+=3){
      const x=positions[i]??0,y=positions[i+1]??0,z=positions[i+2]??0;
      if(x<minX)minX=x;if(x>maxX)maxX=x;
      if(y<minY)minY=y;if(y>maxY)maxY=y;
      if(z<minZ)minZ=z;if(z>maxZ)maxZ=z;
    }

    // Build holes list from Gmsh surface identification. Use
    // gmshResult.holeRadius (the correct circle-fit radius from
    // identifySurfaces) rather than recomputing it here — this previously
    // used max distance among wall nodes as a radius estimate, which is
    // both an independent reimplementation of the same calculation done
    // correctly elsewhere AND a less accurate one (max instead of mean).
    const holes: Array<{id:number; centre:[number,number,number]; normal:[number,number,number]; radius:number; diameter:number; confidence:number; edgeCount:number; warning:string|null}> = [];
    let holeId = 0;
    for (const [gmshHoleId, nodeIndices] of gmshResult.holeWallNodes) {
      // Estimate hole centre from wall nodes (radius comes from gmshResult.holeRadius)
      let cx=0,cy=0,cz=0;
      for (const ni of nodeIndices) {
        cx += mesh.nodes[ni*3]??0;
        cy += mesh.nodes[ni*3+1]??0;
        cz += mesh.nodes[ni*3+2]??0;
      }
      const n = nodeIndices.length || 1;
      cx/=n; cy/=n; cz/=n;
      const r = gmshResult.holeRadius.get(gmshHoleId) ?? 0;
      holes.push({ id: holeId++, centre:[cx,cy,cz], normal:[0,0,1], radius:r,
        diameter:r*2, confidence:0.95, edgeCount:nodeIndices.length, warning:null });
    }

    // Flag overlapping (likely Gmsh-merged) hole detections (see upload path).
    const holeWarnings = flagMergedHoleWarnings(holes);
    holes.forEach((h, i) => {
      if (holeWarnings[i]) { h.warning = holeWarnings[i]; h.confidence = Math.min(h.confidence, 0.5); }
    });

    console.log(`[onshape] ${triCount} surface tris, ${holes.length} holes` +
      (holeWarnings.filter(Boolean).length ? ` (${holeWarnings.filter(Boolean).length} flagged as possibly merged)` : ""));

    res.json({
      fileType:      "step",
      fileName,
      triangleCount: triCount,
      bounds:        { minX, maxX, minY, maxY, minZ, maxZ },
      dimensions:    { x:+(maxX-minX).toFixed(3), y:+(maxY-minY).toFixed(3), z:+(maxZ-minZ).toFixed(3) },
      holes,
      positionsB64:  Buffer.from(positions.buffer).toString("base64"),
      stepB64:       buffer.toString("base64"),
      onshapeUrl:    urlStr,
    });
  } catch (e) {
    console.error("[onshape error]", e);
    res.status(500).json({ error: String(e) });
  }
});

// DELETE /api/onshape/credentials — remove saved key
app.delete("/api/onshape/credentials", (_req, res) => {
  try {
    if (fs.existsSync(ONSHAPE_CREDS_PATH)) fs.unlinkSync(ONSHAPE_CREDS_PATH);
    res.json({ cleared: true });
  } catch { res.json({ cleared: true }); }
});

// ── Fallback error handler ────────────────────────────────────────────────────
// Catches errors raised by middleware before any route runs (malformed JSON
// from body-parser, multer file-filter rejections, CORS denials) and errors
// thrown synchronously inside routes, so that EVERY error response uses the
// same { error, field?, hint? } envelope instead of Express's HTML error page.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) { next(err); return; }
  const e = err as { type?: string; message?: string; status?: number };
  if (e?.type === "entity.parse.failed") {
    res.status(400).json({
      error: "Malformed JSON body",
      hint:  e.message ?? "the request body could not be parsed as JSON",
    });
    return;
  }
  if (e?.type === "entity.too.large") {
    res.status(413).json({
      error: "Request body too large",
      hint:  "the JSON body limit is 50 MB",
    });
    return;
  }
  const message = e?.message ?? String(err);
  if ((err as { name?: string })?.name === "MulterError") {
    // Upload errors (unexpected field name, too many files, file too large).
    const code = (err as { code?: string }).code;
    res.status(code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error: `Upload rejected: ${message}`,
      field: "file",
      hint:  code === "LIMIT_FILE_SIZE"
        ? "the upload limit is 50 MB — decimate the mesh in your CAD/slicer tool and re-export"
        : "send a single multipart/form-data part named 'file'",
    });
    return;
  }
  if (/^CORS:/.test(message))   { res.status(403).json({ error: message }); return; }
  if (/Unsupported file type/.test(message)) {
    res.status(400).json({ error: message, field: "file", hint: "only .stl, .step and .stp files are accepted" });
    return;
  }
  console.error("[unhandled route error]", err);
  res.status(typeof e?.status === "number" ? e.status : 500).json({ error: message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
import { probeTetGen, TetGenNotFoundError } from "./tetgen.js";
import { probeGmsh }   from "./gmsh_mesh.js";

/**
 * Check meshing binaries at startup and print a clear status banner. Without
 * TetGen, STL analyses fail fast with an install hint (issue #106 — they used
 * to silently degrade to a featureless box mesh whose error message blamed the
 * user's geometry); without Gmsh, STEP analysis can't run at all. Making this
 * loud at launch surfaces the "install this" message before the user wastes a
 * run. The probe result is also cached inside tetgen.ts so a missing binary is
 * reported immediately, without retrying four switch sets per analysis.
 */
async function checkMeshingBinaries(): Promise<void> {
  const [tet, gm] = await Promise.all([probeTetGen(), probeGmsh()]);

  console.log("  Meshing tools:");
  if (tet.found) {
    console.log(`    ✓ TetGen  — found (${tet.path})`);
  } else {
    console.log(`    ✗ TetGen  — NOT FOUND (looked for '${tet.path}')`);
    console.log(`              STL analyses will fail with an install hint until`);
    console.log(`              TetGen is available.`);
    console.log(`              To install TetGen:`);
    if (process.platform === "win32") {
      console.log(`              Windows: Download tetgen.exe from`);
      console.log(`              https://github.com/emersonkeenan/tetgen1.5.1-beta1/releases`);
      console.log(`              then rename to tetgen.exe and place in this directory.`);
    } else if (process.platform === "darwin") {
      console.log(`              macOS: brew install tetgen`);
    } else {
      console.log(`              Linux: apt-get install tetgen`);
    }
  }
  if (gm.found) {
    console.log(`    ✓ Gmsh    — found${gm.version ? ` (${gm.version})` : ""} (${gm.path})`);
  } else {
    console.log(`    ✗ Gmsh    — NOT FOUND (looked for '${gm.path}')`);
    console.log(`              STEP/CAD analysis will be unavailable.`);
  }
  console.log("");
}

const PORT = 3000;
app.listen(PORT, async () => {
  console.log("");
  console.log("  ╔══════════════════════════════════════╗");
  console.log("  ║   STORMFEA  —  local server          ║");
  console.log("  ╚══════════════════════════════════════╝");
  console.log("");
  console.log(`  Open your browser at:  http://localhost:${PORT}`);
  console.log("");
  await checkMeshingBinaries();
  console.log("  Press Ctrl+C to stop.");
  console.log("");
});
