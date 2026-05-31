import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const BASE_COLOR = [0.32, 0.5, 0.72];
const OCCT_VERSION = "0.0.22";
const OCCT_BASE_URL = `https://cdn.jsdelivr.net/npm/occt-import-js@${OCCT_VERSION}/dist/`;

const MATERIALS = [
  { id: "pla", label: "PLA", tensile: 37, flexural: 80, density: 1.24 },
  { id: "petg", label: "PETG", tensile: 53, flexural: 72, density: 1.27 },
  { id: "abs", label: "ABS", tensile: 40, flexural: 68, density: 1.05 },
  { id: "asa", label: "ASA", tensile: 48, flexural: 74, density: 1.07 },
  { id: "tpu", label: "TPU 95A", tensile: 30, flexural: 12, density: 1.21 },
  { id: "nylon", label: "Nylon PA12", tensile: 48, flexural: 68, density: 1.01 },
  { id: "pc", label: "Polycarbonate", tensile: 68, flexural: 90, density: 1.2 },
  { id: "cf_pla", label: "CF-PLA", tensile: 58, flexural: 102, density: 1.3 },
];

const SEVERITY = {
  critical: { color: "#ff3d3d", bg: "#2a0808" },
  high: { color: "#ff8c42", bg: "#261508" },
  medium: { color: "#ffd166", bg: "#261e08" },
  low: { color: "#06d6a0", bg: "#08261e" },
};

const DIRECTION_PRESETS = [
  { label: "+X", vec: [1, 0, 0] },
  { label: "-X", vec: [-1, 0, 0] },
  { label: "+Y", vec: [0, 1, 0] },
  { label: "-Y", vec: [0, -1, 0] },
  { label: "+Z", vec: [0, 0, 1] },
  { label: "-Z", vec: [0, 0, -1] },
];

const LAYER_ADHESION = [
  { id: "poor", label: "Poor", factor: 0.32 },
  { id: "normal", label: "Normal", factor: 0.45 },
  { id: "tuned", label: "Tuned", factor: 0.58 },
];

const BUILD_AXIS_BY_ORIENTATION = {
  flat: new THREE.Vector3(0, 1, 0),
  upright: new THREE.Vector3(0, 0, 1),
  angled: new THREE.Vector3(0.707, 0.707, 0),
};

let occtPromise = null;

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function assertBufferLength(buffer, minLength, message) {
  if (!buffer || buffer.byteLength < minLength) {
    throw new Error(message);
  }
}

function parseSTL(buffer) {
  assertBufferLength(buffer, 84, "STL file is too small to be valid.");

  const headerText = new TextDecoder("utf-8", { fatal: false }).decode(buffer.slice(0, 256));
  const likelyAscii = headerText.trimStart().startsWith("solid") && !headerText.includes("\0");

  if (likelyAscii) {
    try {
      return parseASCIISTL(new TextDecoder("utf-8", { fatal: false }).decode(buffer));
    } catch {
      return parseBinarySTL(buffer);
    }
  }

  return parseBinarySTL(buffer);
}

function parseBinarySTL(buffer) {
  assertBufferLength(buffer, 84, "Binary STL file is missing its header.");

  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  const expectedBytes = 84 + triangleCount * 50;

  if (triangleCount <= 0 || expectedBytes > buffer.byteLength) {
    throw new Error("Binary STL triangle count is invalid or truncated.");
  }

  const positions = new Float32Array(triangleCount * 9);
  const normals = new Float32Array(triangleCount * 9);
  let offset = 84;
  let vertexOffset = 0;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;

    for (let vertex = 0; vertex < 3; vertex += 1) {
      positions[vertexOffset] = view.getFloat32(offset, true);
      positions[vertexOffset + 1] = view.getFloat32(offset + 4, true);
      positions[vertexOffset + 2] = view.getFloat32(offset + 8, true);
      normals[vertexOffset] = nx;
      normals[vertexOffset + 1] = ny;
      normals[vertexOffset + 2] = nz;
      vertexOffset += 3;
      offset += 12;
    }

    offset += 2;
  }

  return { positions, normals, triangleCount };
}

function parseASCIISTL(text) {
  const positions = [];
  const normals = [];
  const facetRegex = /facet\s+normal\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)[\s\S]*?outer\s+loop([\s\S]*?)endloop/gi;
  const vertexRegex = /vertex\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi;
  let facetMatch;

  while ((facetMatch = facetRegex.exec(text))) {
    const normal = [Number(facetMatch[1]), Number(facetMatch[2]), Number(facetMatch[3])];
    const vertices = [...facetMatch[4].matchAll(vertexRegex)];

    if (vertices.length !== 3) {
      continue;
    }

    vertices.forEach((vertex) => {
      positions.push(Number(vertex[1]), Number(vertex[2]), Number(vertex[3]));
      normals.push(...normal);
    });
  }

  if (positions.length === 0 || positions.length % 9 !== 0) {
    throw new Error("ASCII STL contained no valid triangular facets.");
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    triangleCount: positions.length / 9,
  };
}

function loadOcct() {
  if (!isBrowser()) {
    return Promise.reject(new Error("STEP parsing is only available in a browser."));
  }

  if (occtPromise) {
    return occtPromise;
  }

  occtPromise = new Promise((resolve, reject) => {
    const start = () => {
      window
        .occtimportjs({ locateFile: (fileName) => `${OCCT_BASE_URL}${fileName}` })
        .then(resolve)
        .catch(reject);
    };

    if (window.occtimportjs) {
      start();
      return;
    }

    const script = document.createElement("script");
    script.src = `${OCCT_BASE_URL}occt-import-js.js`;
    script.async = true;
    script.onload = start;
    script.onerror = () => reject(new Error("Failed to load the OCCT STEP engine."));
    document.head.appendChild(script);
  });

  return occtPromise;
}

async function parseSTEP(buffer, onProgress = () => {}) {
  onProgress("Loading STEP engine...");
  const occt = await loadOcct();
  onProgress("Tessellating STEP geometry...");

  const result = occt.ReadStepFile(new Uint8Array(buffer), {
    linearDeflection: 0.1,
    angularDeflection: 0.5,
  });

  if (!result?.success) {
    throw new Error("STEP parse failed. The file may be corrupt or unsupported.");
  }

  const positions = [];
  const normals = [];

  for (const mesh of result.meshes ?? []) {
    const coords = mesh.attributes?.position?.array;
    const meshNormals = mesh.attributes?.normal?.array;

    if (!coords?.length) {
      continue;
    }

    if (mesh.index?.array?.length) {
      for (const index of mesh.index.array) {
        const vertexOffset = index * 3;
        positions.push(coords[vertexOffset], coords[vertexOffset + 1], coords[vertexOffset + 2]);
        normals.push(
          meshNormals?.[vertexOffset] ?? 0,
          meshNormals?.[vertexOffset + 1] ?? 1,
          meshNormals?.[vertexOffset + 2] ?? 0,
        );
      }
    } else {
      for (let i = 0; i < coords.length; i += 3) {
        positions.push(coords[i], coords[i + 1], coords[i + 2]);
        normals.push(meshNormals?.[i] ?? 0, meshNormals?.[i + 1] ?? 1, meshNormals?.[i + 2] ?? 0);
      }
    }
  }

  if (positions.length === 0 || positions.length % 9 !== 0) {
    throw new Error("STEP file contained no triangular mesh geometry.");
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    triangleCount: positions.length / 9,
  };
}

function getMeshStats(parsed) {
  const { positions } = parsed;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  return {
    triangles: parsed.triangleCount,
    dims: {
      x: maxX - minX,
      y: maxY - minY,
      z: maxZ - minZ,
    },
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  };
}

function stressColor(value) {
  const stops = [
    [0.08, 0.2, 0.85],
    [0, 0.75, 0.85],
    [0.1, 0.82, 0.2],
    [1, 0.82, 0],
    [1, 0.1, 0.05],
  ];
  const scaled = THREE.MathUtils.clamp(value, 0, 1) * (stops.length - 1);
  const index = Math.min(Math.floor(scaled), stops.length - 2);
  const fraction = scaled - index;
  return stops[index].map((channel, channelIndex) => channel + fraction * (stops[index + 1][channelIndex] - channel));
}

function safeDirection(direction) {
  const vector = new THREE.Vector3(...direction);
  return vector.lengthSq() > 0 ? vector.normalize() : new THREE.Vector3(0, -1, 0);
}

function makeArrow(direction, origin, length, color) {
  const group = new THREE.Group();
  const normalizedDirection = safeDirection(direction);
  const shaftLength = length * 0.78;
  const headLength = length * 0.22;
  const material = new THREE.MeshPhongMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.3,
  });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(length * 0.03, length * 0.03, shaftLength, 10), material);
  const head = new THREE.Mesh(new THREE.ConeGeometry(length * 0.09, headLength, 12), material);

  shaft.position.y = shaftLength / 2;
  head.position.y = shaftLength + headLength / 2;
  group.add(shaft, head);
  group.position.copy(origin);
  group.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normalizedDirection));

  return group;
}

function makeBoltMarker(position, normal, color = 0x00e5ff) {
  const group = new THREE.Group();
  const material = new THREE.MeshPhongMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.9,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), material);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 28), material);
  const safeNormal = normal.lengthSq() > 0 ? normal.clone().normalize() : new THREE.Vector3(0, 0, 1);

  ring.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), safeNormal));
  group.position.copy(position);
  group.add(sphere, ring);

  return group;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose());
    } else if (child.material) {
      child.material.dispose();
    }
  });
}

function modelPointToMeshLocal(point, offset) {
  return new THREE.Vector3(point.x, point.y, point.z).sub(offset);
}

function getBuildAxis(settings) {
  return (BUILD_AXIS_BY_ORIENTATION[settings.orientation] ?? BUILD_AXIS_BY_ORIENTATION.flat).clone().normalize();
}

function getAdhesion(settings) {
  return LAYER_ADHESION.find((item) => item.id === settings.layerAdhesion) ?? LAYER_ADHESION[1];
}

function getPrintSection(stlStats, settings) {
  const dims = [stlStats.dims.x, stlStats.dims.y, stlStats.dims.z].map((value) => Math.max(value, 1));
  const sorted = [...dims].sort((a, b) => a - b);
  const minDim = sorted[0];
  const midDim = sorted[1];
  const maxDim = sorted[2];
  const wallThickness = Math.max(settings.wallCount * settings.lineWidth, settings.nozzleDiameter);
  const shellRatio = THREE.MathUtils.clamp((2 * wallThickness) / Math.max(minDim, 0.1), 0.08, 0.92);
  const infillRatio = THREE.MathUtils.clamp(settings.infill / 100, 0.05, 1);
  const effectiveAreaRatio = THREE.MathUtils.clamp(shellRatio + (1 - shellRatio) * infillRatio * 0.55, 0.08, 1);

  return {
    minDim,
    midDim,
    maxDim,
    wallThickness,
    shellRatio,
    infillRatio,
    effectiveAreaRatio,
  };
}

function getPrintStrength(material, settings) {
  const adhesion = getAdhesion(settings);
  const chamberFactor = settings.enclosure ? 1.08 : 0.94;
  const layerHeightFactor = THREE.MathUtils.clamp(settings.nozzleDiameter / Math.max(settings.layerHeight, 0.05) / 2, 0.72, 1.18);
  const wallFactor = THREE.MathUtils.clamp(0.65 + settings.wallCount * 0.07, 0.72, 1.28);
  const infillFactor = 0.32 + (settings.infill / 100) * 0.48;
  const xyTensile = material.tensile * wallFactor * infillFactor * chamberFactor;
  const zTensile = xyTensile * adhesion.factor * layerHeightFactor;
  const xyFlexural = material.flexural * (0.38 + settings.infill / 140) * wallFactor * chamberFactor;
  const zShear = Math.min(zTensile * 0.62, material.tensile * adhesion.factor * 0.72);

  return {
    xyTensile,
    zTensile,
    xyFlexural,
    zShear,
    adhesion,
    layerHeightFactor,
    chamberFactor,
  };
}

function getLoadPrintRisk(forces, settings) {
  const buildAxis = getBuildAxis(settings);
  const totalForce = Math.max(forces.reduce((sum, force) => sum + force.magnitude, 0), 1);
  let peelForce = 0;
  let shearForce = 0;

  for (const force of forces) {
    const direction = safeDirection(force.dir);
    const normalComponent = Math.abs(direction.dot(buildAxis));
    peelForce += force.magnitude * normalComponent;
    shearForce += force.magnitude * Math.sqrt(Math.max(0, 1 - normalComponent * normalComponent));
  }

  return {
    buildAxis,
    peelRatio: peelForce / totalForce,
    shearRatio: shearForce / totalForce,
  };
}

function severityFromSafetyFactor(value) {
  if (value < 1) return "critical";
  if (value < 1.5) return "high";
  if (value < 2.25) return "medium";
  return "low";
}

function computeLocalStressWeights({ stlData, stlStats, bolts, forces, material, settings }) {
  const vertexCount = stlData.positions.length / 3;
  const weights = new Float32Array(vertexCount);
  const { minX, maxX, minY, maxY, minZ, maxZ } = stlStats.bounds;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const rangeZ = maxZ - minZ || 1;
  const maxForce = Math.max(...forces.map((force) => force.magnitude), 1);
  const strength = getPrintStrength(material, settings);
  const printSection = getPrintSection(stlStats, settings);
  const printRisk = getLoadPrintRisk(forces, settings);
  const weakLayerPenalty = THREE.MathUtils.clamp(1 - strength.zTensile / Math.max(strength.xyTensile, 1), 0, 0.45);

  for (let i = 0; i < vertexCount; i += 1) {
    const x = stlData.positions[i * 3];
    const y = stlData.positions[i * 3 + 1];
    const z = stlData.positions[i * 3 + 2];
    const nx = (x - minX) / rangeX;
    const ny = (y - minY) / rangeY;
    const nz = (z - minZ) / rangeZ;
    let weight = 0.08;

    for (const bolt of bolts) {
      const dx = (x - bolt.origPos.x) / rangeX;
      const dy = (y - bolt.origPos.y) / rangeY;
      const dz = (z - bolt.origPos.z) / rangeZ;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance < 0.22) {
        weight = Math.max(weight, 0.55 * (1 - distance / 0.22));
      }
    }

    for (const force of forces) {
      const forceScale = Math.min(1, force.magnitude / maxForce);
      const dx = (x - force.origPos.x) / rangeX;
      const dy = (y - force.origPos.y) / rangeY;
      const dz = (z - force.origPos.z) / rangeZ;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance < 0.28) {
        weight = Math.max(weight, (0.45 + 0.35 * forceScale) * (1 - distance / 0.28));
      }

      const nearestBolt = bolts.reduce((nearest, bolt) => {
        const boltDistance =
          ((force.origPos.x - bolt.origPos.x) / rangeX) ** 2 +
          ((force.origPos.y - bolt.origPos.y) / rangeY) ** 2 +
          ((force.origPos.z - bolt.origPos.z) / rangeZ) ** 2;
        return boltDistance < nearest.distance ? { bolt, distance: boltDistance } : nearest;
      }, { bolt: bolts[0], distance: Infinity }).bolt;

      if (nearestBolt) {
        const fx = (force.origPos.x - minX) / rangeX;
        const fy = (force.origPos.y - minY) / rangeY;
        const fz = (force.origPos.z - minZ) / rangeZ;
        const bx = (nearestBolt.origPos.x - minX) / rangeX;
        const by = (nearestBolt.origPos.y - minY) / rangeY;
        const bz = (nearestBolt.origPos.z - minZ) / rangeZ;
        const lx = bx - fx;
        const ly = by - fy;
        const lz = bz - fz;
        const lengthSq = lx * lx + ly * ly + lz * lz;

        if (lengthSq > 0.0001) {
          const t = THREE.MathUtils.clamp(((nx - fx) * lx + (ny - fy) * ly + (nz - fz) * lz) / lengthSq, 0, 1);
          const cx = fx + t * lx;
          const cy = fy + t * ly;
          const cz = fz + t * lz;
          const pathDistance = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2 + (nz - cz) ** 2);

          if (pathDistance < 0.1) {
            weight = Math.max(weight, (0.34 + 0.22 * forceScale) * (1 - pathDistance / 0.1));
          }
        }
      }
    }

    const normalizedPosition = new THREE.Vector3(nx - 0.5, ny - 0.5, nz - 0.5);
    const layerCoordinate = Math.abs(normalizedPosition.dot(printRisk.buildAxis));
    const edgeDistance = Math.max(Math.abs(nx - 0.5), Math.abs(ny - 0.5), Math.abs(nz - 0.5)) * 2;
    const shellBoost = edgeDistance > 1 - printSection.shellRatio ? 0.1 : 0;
    const layerPenalty = weakLayerPenalty * (0.35 + layerCoordinate) * (0.55 + printRisk.peelRatio);
    const sparseInfillPenalty = Math.max(0, 0.35 - printSection.infillRatio) * 0.22;
    weights[i] = THREE.MathUtils.clamp(weight + shellBoost + layerPenalty + sparseInfillPenalty, 0, 1);
  }

  return weights;
}

function createLocalAnalysis({ stlStats, bolts, forces, material, settings }) {
  const totalForce = forces.reduce((sum, force) => sum + force.magnitude, 0);
  const section = getPrintSection(stlStats, settings);
  const strength = getPrintStrength(material, settings);
  const printRisk = getLoadPrintRisk(forces, settings);
  const maxSpan = section.maxDim;
  const minSection = section.minDim;
  const effectiveStrength = strength.xyTensile * section.effectiveAreaRatio;
  const zStrength = strength.zTensile * section.effectiveAreaRatio;
  const layerShearStrength = strength.zShear * (0.7 + section.shellRatio * 0.3);
  const constraintFactor = Math.max(1, bolts.length * 0.65);
  const nominalArea = minSection * section.midDim;
  const effectiveArea = Math.max(nominalArea * section.effectiveAreaRatio, 1);
  const bendingStress = (totalForce * maxSpan) / Math.max(section.wallThickness * section.midDim * constraintFactor * 7.5, 1);
  const directStress = totalForce / effectiveArea;
  const maxStress = Math.max(bendingStress, directStress);
  const layerPeelStress = (totalForce * printRisk.peelRatio) / Math.max(effectiveArea * 0.55, 1);
  const layerShearStress = (totalForce * printRisk.shearRatio) / Math.max(effectiveArea * 0.75, 1);
  const bearingStress = totalForce / Math.max(bolts.length * section.wallThickness * Math.max(settings.nozzleDiameter * 4, 1), 1);
  const bulkSafetyFactor = Math.max(0.1, effectiveStrength / Math.max(maxStress, 0.1));
  const layerSafetyFactor = Math.max(0.1, zStrength / Math.max(layerPeelStress + layerShearStress * 0.45, 0.1));
  const bearingSafetyFactor = Math.max(0.1, strength.xyTensile * 0.78 / Math.max(bearingStress, 0.1));
  const safetyFactor = Math.min(bulkSafetyFactor, layerSafetyFactor, bearingSafetyFactor);
  const displacement = (totalForce * maxSpan) / Math.max(strength.xyFlexural * 650 * constraintFactor * section.wallThickness, 1);
  const bucklingLoad = Math.max(1, (strength.xyFlexural * section.wallThickness * section.midDim * (0.35 + settings.infill / 120)) / Math.max(maxSpan / 45, 1));
  const bucklingSafetyFactor = bucklingLoad / Math.max(totalForce, 1);
  const overallRisk = severityFromSafetyFactor(Math.min(safetyFactor, bucklingSafetyFactor));
  const controllingMode = [
    ["bulk bending/tension", bulkSafetyFactor],
    ["layer delamination", layerSafetyFactor],
    ["bolt bearing/crush", bearingSafetyFactor],
    ["buckling", bucklingSafetyFactor],
  ].sort((a, b) => a[1] - b[1])[0];

  return {
    safetyFactor,
    bulkSafetyFactor,
    layerSafetyFactor,
    bearingSafetyFactor,
    bucklingSafetyFactor,
    maxStress,
    layerPeelStress,
    layerShearStress,
    effectiveStrength,
    zStrength,
    wallThickness: section.wallThickness,
    shellRatio: section.shellRatio,
    controllingMode: controllingMode[0],
    displacement,
    bucklingLoad,
    overallRisk,
    summary:
      `The controlling print-specific risk is ${controllingMode[0]} with an estimated safety factor of ${controllingMode[1].toFixed(2)}. This screening model accounts for shell thickness, infill efficiency, layer adhesion, build orientation, and load direction, but it is not a certified solver.`,
    failureModes: [
      {
        name: "Bolt-zone stress concentration",
        severity: severityFromSafetyFactor(bearingSafetyFactor),
        location: `${bolts[0]?.label ?? "B1"} and nearby load paths`,
        description: "Printed plastic can crush or split around fixed constraints because load enters through a small shell area before reaching the infill.",
        recommendation: "Increase boss diameter, add washers or heat-set inserts, add fillets, and keep at least 4-6 walls around mounting holes.",
      },
      {
        name: "Layer delamination",
        severity: severityFromSafetyFactor(layerSafetyFactor),
        location: `${settings.orientation} print orientation`,
        description: "Forces with a component along the build axis load the weaker layer bonds instead of continuous extrusion roads.",
        recommendation: "Rotate the print so main tensile loads run in the XY plane, lower layer height, improve temperature tuning, or use an enclosure.",
      },
      {
        name: "Sparse infill shear lag",
        severity: settings.infill < 30 ? "high" : settings.infill < 50 ? "medium" : "low",
        location: "Between outer walls and internal infill",
        description: "The outer shell carries most local stress while infill contributes less efficiently, especially near point loads.",
        recommendation: "Increase wall count first, then raise infill density or use a stronger infill pattern around load paths.",
      },
    ],
    printRecommendations: [
      `Target wall thickness is ${section.wallThickness.toFixed(2)} mm; increase walls if bolt or force areas are small.`,
      `Estimated Z strength is ${zStrength.toFixed(1)} MPa versus ${effectiveStrength.toFixed(1)} MPa in-plane, so orientation matters.`,
      "For safety-critical parts, validate with real material coupons and a solver that supports anisotropic FDM material properties.",
    ],
  };
}

function Viewer({ stlData, stressWeights, showStress, bolts, forces, mode, onPickPoint }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const meshRef = useRef(null);
  const overlayRootRef = useRef(null);
  const animationRef = useRef(null);
  const mouseRef = useRef({ isDown: false, moved: false, x: 0, y: 0 });
  const rotationRef = useRef({ x: 0.3, y: 0.5 });
  const zoomRef = useRef(3);

  useEffect(() => {
    const element = mountRef.current;
    if (!element) {
      return undefined;
    }

    const width = Math.max(element.clientWidth, 1);
    const height = Math.max(element.clientHeight, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.001, 1000);
    const keyLight = new THREE.DirectionalLight(0xfff5e0, 1.2);
    const fillLight = new THREE.DirectionalLight(0xd0e8ff, 0.5);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    camera.position.set(0, 0, zoomRef.current);
    keyLight.position.set(2, 4, 3);
    fillLight.position.set(-3, -1, -2);
    scene.add(new THREE.AmbientLight(0xffffff, 0.45), keyLight, fillLight);
    element.appendChild(renderer.domElement);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;

    const renderLoop = () => {
      animationRef.current = requestAnimationFrame(renderLoop);
      renderer.render(scene, camera);
    };

    const onResize = () => {
      const nextWidth = Math.max(element.clientWidth, 1);
      const nextHeight = Math.max(element.clientHeight, 1);
      renderer.setSize(nextWidth, nextHeight);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    };

    renderLoop();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", onResize);
      if (meshRef.current) {
        disposeObject(meshRef.current);
      }
      renderer.dispose();
      renderer.forceContextLoss();
      if (element.contains(renderer.domElement)) {
        element.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !stlData) {
      return;
    }

    if (meshRef.current) {
      scene.remove(meshRef.current);
      disposeObject(meshRef.current);
      meshRef.current = null;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(stlData.positions.slice(), 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(stlData.normals.slice(), 3));

    if (!stlData.normals?.length) {
      geometry.computeVertexNormals();
    }

    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
      throw new Error("Model has invalid dimensions.");
    }

    const vertexCount = stlData.positions.length / 3;
    const colors = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i += 1) {
      colors.set(BASE_COLOR, i * 3);
    }

    geometry.translate(-center.x, -center.y, -center.z);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 55,
      specular: new THREE.Color(0x333333),
    });
    const mesh = new THREE.Mesh(geometry, material);
    const overlayRoot = new THREE.Group();

    mesh.scale.setScalar(1.6 / maxDimension);
    mesh.rotation.set(rotationRef.current.x, rotationRef.current.y, 0);
    mesh.userData.originalCenter = center;
    mesh.add(overlayRoot);
    scene.add(mesh);

    meshRef.current = mesh;
    overlayRootRef.current = overlayRoot;
    zoomRef.current = 3;

    if (cameraRef.current) {
      cameraRef.current.position.z = zoomRef.current;
    }
  }, [stlData]);

  useEffect(() => {
    const geometry = meshRef.current?.geometry;
    const colors = geometry?.attributes?.color?.array;
    if (!geometry || !colors) {
      return;
    }

    const vertexCount = colors.length / 3;
    for (let i = 0; i < vertexCount; i += 1) {
      const color = showStress && stressWeights ? stressColor(stressWeights[i] ?? 0) : BASE_COLOR;
      colors.set(color, i * 3);
    }

    geometry.attributes.color.needsUpdate = true;
  }, [showStress, stressWeights]);

  useEffect(() => {
    const mesh = meshRef.current;
    const overlayRoot = overlayRootRef.current;
    if (!mesh || !overlayRoot) {
      return;
    }

    overlayRoot.children.forEach(disposeObject);
    overlayRoot.clear();

    const center = mesh.userData.originalCenter;
    bolts.forEach((bolt) => {
      const localPosition = modelPointToMeshLocal(bolt.origPos, center);
      overlayRoot.add(makeBoltMarker(localPosition, bolt.localNorm ?? bolt.worldNorm));
    });

    forces.forEach((force) => {
      const localPosition = modelPointToMeshLocal(force.origPos, center);
      const arrowLength = 0.18 + Math.log10(Math.max(force.magnitude, 1)) * 0.06;
      overlayRoot.add(makeArrow(new THREE.Vector3(...force.dir), localPosition, arrowLength, 0xe06030));
    });
  }, [bolts, forces]);

  const pick = useCallback(
    (event) => {
      const mesh = meshRef.current;
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      const element = mountRef.current;

      if (!mesh || !renderer || !camera || !element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      const [hit] = raycaster.intersectObject(mesh, false);
      if (!hit?.face) {
        return;
      }

      const localPos = mesh.worldToLocal(hit.point.clone());
      const origPos = localPos.clone().add(mesh.userData.originalCenter);
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      const worldNorm = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
      const localNorm = hit.face.normal.clone().normalize();

      onPickPoint?.({
        worldPos: hit.point.clone(),
        origPos,
        worldNorm,
        localNorm,
        screenX: event.clientX,
        screenY: event.clientY,
      });
    },
    [onPickPoint],
  );

  const onMouseDown = (event) => {
    mouseRef.current = { isDown: true, moved: false, x: event.clientX, y: event.clientY };
  };

  const onMouseMove = (event) => {
    if (!mouseRef.current.isDown || !meshRef.current) {
      return;
    }

    const dx = event.clientX - mouseRef.current.x;
    const dy = event.clientY - mouseRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      mouseRef.current.moved = true;
    }

    rotationRef.current.y += dx * 0.008;
    rotationRef.current.x += dy * 0.008;
    meshRef.current.rotation.set(rotationRef.current.x, rotationRef.current.y, 0);
    mouseRef.current.x = event.clientX;
    mouseRef.current.y = event.clientY;
  };

  const onMouseUp = (event) => {
    if (mouseRef.current.isDown && !mouseRef.current.moved && mode !== "view") {
      pick(event);
    }
    mouseRef.current.isDown = false;
  };

  const onWheel = (event) => {
    event.preventDefault();
    zoomRef.current = THREE.MathUtils.clamp(zoomRef.current + event.deltaY * 0.005, 1, 10);
    if (cameraRef.current) {
      cameraRef.current.position.z = zoomRef.current;
    }
  };

  return (
    <div
      ref={mountRef}
      style={{ width: "100%", height: "100%", cursor: mode === "view" ? "grab" : "crosshair" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        mouseRef.current.isDown = false;
      }}
      onWheel={onWheel}
    />
  );
}

function ForcePopup({ screenPos, onConfirm, onCancel }) {
  const [magnitude, setMagnitude] = useState(100);
  const [directionIndex, setDirectionIndex] = useState(3);
  const [customDirection, setCustomDirection] = useState([0, -1, 0]);
  const [useCustom, setUseCustom] = useState(false);
  const direction = useCustom ? customDirection : DIRECTION_PRESETS[directionIndex].vec;

  return (
    <div
      style={{
        position: "fixed",
        left: Math.min(screenPos.x + 10, window.innerWidth - 260),
        top: Math.min(screenPos.y - 20, window.innerHeight - 300),
        width: 240,
        background: "#111115",
        border: "1px solid #2e2e38",
        borderRadius: 6,
        padding: 16,
        zIndex: 1000,
        boxShadow: "0 8px 32px #00000088",
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#e06030", textTransform: "uppercase", marginBottom: 12 }}>
        Add Force
      </div>
      <div style={{ fontSize: 9, color: "#555", marginBottom: 8, letterSpacing: "0.1em" }}>MAGNITUDE</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <input type="range" min={1} max={2000} value={magnitude} onChange={(event) => setMagnitude(Number(event.target.value))} style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#e06030", minWidth: 55 }}>{magnitude} N</span>
      </div>
      <div style={{ fontSize: 9, color: "#555", marginBottom: 8, letterSpacing: "0.1em" }}>DIRECTION</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 10 }}>
        {DIRECTION_PRESETS.map((preset, index) => (
          <button
            key={preset.label}
            onClick={() => {
              setDirectionIndex(index);
              setUseCustom(false);
            }}
            style={{
              padding: "5px 4px",
              fontSize: 9,
              background: !useCustom && directionIndex === index ? "#1e1008" : "#0f0f12",
              border: `1px solid ${!useCustom && directionIndex === index ? "#e06030" : "#222"}`,
              color: !useCustom && directionIndex === index ? "#e06030" : "#555",
              cursor: "pointer",
              borderRadius: 3,
              fontFamily: "inherit",
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {["x", "y", "z"].map((axis, index) => (
          <div key={axis} style={{ flex: 1 }}>
            <div style={{ fontSize: 8, color: "#444", marginBottom: 3, letterSpacing: "0.1em" }}>{axis.toUpperCase()}</div>
            <input
              type="number"
              step="0.1"
              value={direction[index]}
              onChange={(event) => {
                const nextDirection = [...customDirection];
                nextDirection[index] = Number(event.target.value);
                setCustomDirection(nextDirection);
                setUseCustom(true);
              }}
              style={{
                width: "100%",
                background: "#0a0a0e",
                border: "1px solid #222",
                color: "#c8c0b8",
                padding: "4px 6px",
                fontSize: 11,
                borderRadius: 3,
                fontFamily: "inherit",
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => onConfirm({ magnitude, dir: safeDirection(direction).toArray() })}
          style={{
            flex: 1,
            padding: "8px",
            background: "#e06030",
            color: "#0a0a0c",
            fontSize: 10,
            letterSpacing: "0.12em",
            border: "none",
            cursor: "pointer",
            borderRadius: 3,
            fontFamily: "inherit",
          }}
        >
          Add Force
        </button>
        <button
          onClick={onCancel}
          aria-label="Cancel force"
          style={{
            padding: "8px 12px",
            background: "transparent",
            color: "#555",
            fontSize: 10,
            border: "1px solid #222",
            cursor: "pointer",
            borderRadius: 3,
            fontFamily: "inherit",
          }}
        >
          X
        </button>
      </div>
    </div>
  );
}

export default function FEATool({ analysisProvider }) {
  const [stlData, setStlData] = useState(null);
  const [stlFile, setStlFile] = useState(null);
  const [stlStats, setStlStats] = useState(null);
  const [fileLoading, setFileLoading] = useState(null);
  const [mode, setMode] = useState("view");
  const [bolts, setBolts] = useState([]);
  const [forces, setForces] = useState([]);
  const [pendingPick, setPendingPick] = useState(null);
  const [settings, setSettings] = useState({
    material: "pla",
    infill: 20,
    layerHeight: 0.2,
    wallCount: 3,
    nozzleDiameter: 0.4,
    lineWidth: 0.45,
    orientation: "flat",
    layerAdhesion: "normal",
    enclosure: false,
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState(null);
  const [stressWeights, setStressWeights] = useState(null);
  const [showStress, setShowStress] = useState(true);
  const [activeTab, setActiveTab] = useState("setup");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const material = MATERIALS.find((item) => item.id === settings.material) ?? MATERIALS[0];
  const canAnalyze = Boolean(stlData && stlStats && bolts.length > 0 && forces.length > 0);

  useEffect(() => {
    document.getElementById("static-status")?.remove();
  }, []);

  const statsLabel = useMemo(() => {
    if (!stlStats) {
      return "No mesh loaded";
    }
    return `${stlStats.triangles.toLocaleString()} triangles | ${stlStats.dims.x.toFixed(1)} x ${stlStats.dims.y.toFixed(1)} x ${stlStats.dims.z.toFixed(1)} mm`;
  }, [stlStats]);

  const handleFile = useCallback(async (file) => {
    if (!file) {
      return;
    }

    const name = file.name.toLowerCase();
    const isSTL = name.endsWith(".stl");
    const isSTEP = name.endsWith(".step") || name.endsWith(".stp");

    if (!isSTL && !isSTEP) {
      setFileLoading("Unsupported file type. Use STL, STEP, or STP.");
      setTimeout(() => setFileLoading(null), 3000);
      return;
    }

    setStlFile(file);
    setResults(null);
    setStressWeights(null);
    setBolts([]);
    setForces([]);
    setPendingPick(null);
    setFileLoading(isSTEP ? "Reading STEP file..." : "Parsing STL...");

    try {
      const buffer = await file.arrayBuffer();
      const parsed = isSTEP ? await parseSTEP(buffer, setFileLoading) : parseSTL(buffer);
      const nextStats = getMeshStats(parsed);

      setStlData(parsed);
      setStlStats(nextStats);
      setActiveTab("constraints");
    } catch (error) {
      setFileLoading(error instanceof Error ? error.message : "File parsing failed.");
      setTimeout(() => setFileLoading(null), 5000);
      return;
    }

    setFileLoading(null);
  }, []);

  const onPickPoint = useCallback(
    ({ worldPos, origPos, worldNorm, localNorm, screenX, screenY }) => {
      if (mode === "bolt") {
        setBolts((currentBolts) => [
          ...currentBolts,
          {
            id: crypto.randomUUID(),
            worldPos,
            origPos,
            worldNorm,
            localNorm,
            label: `B${currentBolts.length + 1}`,
          },
        ]);
      } else if (mode === "force") {
        setPendingPick({ worldPos, origPos, worldNorm, localNorm, screenX, screenY });
      }
    },
    [mode],
  );

  const confirmForce = ({ magnitude, dir }) => {
    if (!pendingPick) {
      return;
    }

    setForces((currentForces) => [
      ...currentForces,
      {
        id: crypto.randomUUID(),
        worldPos: pendingPick.worldPos,
        origPos: pendingPick.origPos,
        worldNorm: pendingPick.worldNorm,
        localNorm: pendingPick.localNorm,
        dir,
        magnitude,
        label: `F${currentForces.length + 1}`,
      },
    ]);
    setPendingPick(null);
  };

  const runAnalysis = async () => {
    if (!canAnalyze) {
      return;
    }

    setIsAnalyzing(true);
    setActiveTab("results");

    try {
      const input = { stlData, stlStats, bolts, forces, material, settings };
      const analysis = analysisProvider ? await analysisProvider(input) : createLocalAnalysis(input);
      const weights = computeLocalStressWeights(input);
      setResults(analysis);
      setStressWeights(weights);
      setShowStress(true);
    } catch (error) {
      setResults({ error: error instanceof Error ? error.message : "Analysis failed." });
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#09090b", color: "#e8e4dc", fontFamily: "'DM Mono','Fira Code','Courier New',monospace", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-track{background:#111}
        ::-webkit-scrollbar-thumb{background:#2e2e38}
        input[type=range]{-webkit-appearance:none;height:2px;background:#1e1e24;border-radius:2px;outline:none;width:100%}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#e06030;cursor:pointer}
        input[type=number],select{background:#111115;color:#e8e4dc;border:1px solid #2a2a32;padding:6px 10px;border-radius:3px;font-family:inherit;font-size:11px;outline:none;width:100%}
        input[type=number]:focus,select:focus{border-color:#e06030}
        button:disabled{cursor:not-allowed}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .card{animation:fadeIn 0.35s ease forwards}
      `}</style>

      <div style={{ borderBottom: "1px solid #1a1a20", padding: "10px 20px", display: "flex", alignItems: "center", gap: 14, background: "#0c0c0f", flexShrink: 0 }}>
        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, letterSpacing: "0.14em", color: "#e06030" }}>STRESSFORM</div>
        <div style={{ width: 1, height: 18, background: "#222" }} />
        <div style={{ fontSize: 9, color: "#444", letterSpacing: "0.15em" }}>{statsLabel}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          {["setup", "constraints", "settings", "results"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: "none",
                border: "none",
                borderBottom: `1px solid ${activeTab === tab ? "#e06030" : "transparent"}`,
                color: activeTab === tab ? "#e06030" : "#444",
                fontFamily: "inherit",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                cursor: "pointer",
                padding: "6px 12px",
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: "0 0 55%", position: "relative", borderRight: "1px solid #1a1a20", background: "#07070a" }}>
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              zIndex: 20,
              color: "#e06030",
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              pointerEvents: "none",
            }}
          >
            Stressform Ready
          </div>
          {stlData ? (
            <>
              <Viewer stlData={stlData} stressWeights={stressWeights} showStress={showStress} bolts={bolts} forces={forces} mode={mode} onPickPoint={onPickPoint} />

              <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 6 }}>
                {[
                  { value: "view", label: "Orbit" },
                  { value: "bolt", label: "Bolt" },
                  { value: "force", label: "Force" },
                ].map((item) => (
                  <button
                    key={item.value}
                    onClick={() => setMode(item.value)}
                    style={{
                      padding: "5px 10px",
                      fontSize: 10,
                      background: mode === item.value ? "#1a1008" : "#0f0f12",
                      border: `1px solid ${mode === item.value ? "#e06030" : "#1e1e24"}`,
                      color: mode === item.value ? "#e06030" : "#555",
                      cursor: "pointer",
                      borderRadius: 3,
                      fontFamily: "inherit",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {stressWeights && (
                <button
                  onClick={() => setShowStress((current) => !current)}
                  style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    padding: "5px 10px",
                    fontSize: 9,
                    background: showStress ? "#1a1008" : "#0f0f12",
                    border: `1px solid ${showStress ? "#e06030" : "#1e1e24"}`,
                    color: showStress ? "#e06030" : "#555",
                    cursor: "pointer",
                    borderRadius: 3,
                    fontFamily: "inherit",
                    letterSpacing: "0.1em",
                  }}
                >
                  {showStress ? "STRESS MAP" : "DEFAULT"}
                </button>
              )}

              <div style={{ position: "absolute", bottom: 12, left: 12, display: "flex", gap: 8 }}>
                <span style={{ fontSize: 9, background: "#001a1a", border: "1px solid #00e5ff22", color: "#00e5ff", padding: "3px 8px", borderRadius: 2, letterSpacing: "0.1em" }}>
                  {bolts.length} bolt{bolts.length === 1 ? "" : "s"}
                </span>
                <span style={{ fontSize: 9, background: "#1a0e00", border: "1px solid #e0603022", color: "#e06030", padding: "3px 8px", borderRadius: 2, letterSpacing: "0.1em" }}>
                  {forces.length} force{forces.length === 1 ? "" : "s"}
                </span>
              </div>

              <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", fontSize: 9, color: "#333", pointerEvents: "none" }}>
                {mode === "view" && "drag to rotate | scroll to zoom"}
                {mode === "bolt" && "click mesh to place bolt constraint"}
                {mode === "force" && "click mesh to place force vector"}
              </div>
            </>
          ) : (
            <div
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                handleFile(event.dataTransfer.files[0]);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: "calc(100% - 32px)",
                height: "calc(100% - 32px)",
                margin: 16,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                border: `2px dashed ${dragOver ? "#e06030" : "#1e1e24"}`,
                borderRadius: 4,
                cursor: "pointer",
                background: dragOver ? "#1a0e08" : "transparent",
              }}
            >
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, letterSpacing: "0.22em", color: "#333" }}>DROP STL / STEP FILE</div>
              <div style={{ fontSize: 9, color: "#2a2a2a", marginTop: 6, letterSpacing: "0.1em" }}>or click to browse</div>
              <div style={{ fontSize: 8, color: "#222", marginTop: 3, letterSpacing: "0.08em" }}>.stl | .step | .stp</div>
              <input ref={fileInputRef} type="file" accept=".stl,.step,.stp" style={{ display: "none" }} onChange={(event) => handleFile(event.target.files?.[0])} />
            </div>
          )}

          {pendingPick && <ForcePopup screenPos={{ x: pendingPick.screenX, y: pendingPick.screenY }} onConfirm={confirmForce} onCancel={() => setPendingPick(null)} />}

          {fileLoading && (
            <div style={{ position: "absolute", inset: 0, background: "#07070acc", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
              <div style={{ fontSize: 10, color: "#888", letterSpacing: "0.15em" }}>{fileLoading}</div>
            </div>
          )}
        </div>

        <div style={{ flex: "0 0 45%", overflowY: "auto", background: "#09090b" }}>
          {activeTab === "setup" && (
            <Panel>
              <PanelTitle>WORKFLOW</PanelTitle>
              {[
                ["01", "Upload STL or STEP", "Drop a supported file onto the viewer or click to browse."],
                ["02", "Place bolt constraints", "Switch to Bolt mode and click mesh surfaces."],
                ["03", "Apply force vectors", "Switch to Force mode and click mesh surfaces."],
                ["04", "Configure print settings", "Set material, infill, layer height, and wall count."],
                ["05", "Run analysis", "Generate a screening estimate and stress visualization."],
              ].map(([number, title, description]) => (
                <InfoRow key={number} number={number} title={title} description={description} />
              ))}
              {!stlData && <PrimaryButton onClick={() => fileInputRef.current?.click()}>Upload STL / STEP to Begin</PrimaryButton>}
            </Panel>
          )}

          {activeTab === "constraints" && (
            <Panel>
              <ConstraintSection title="Bolt Constraints" accent="#00e5ff" modeName="bolt" mode={mode} setMode={setMode} empty="No bolt constraints placed yet.">
                {bolts.map((bolt) => (
                  <ItemRow key={bolt.id} color="#00e5ff" title={bolt.label} detail={`(${bolt.origPos.x.toFixed(1)}, ${bolt.origPos.y.toFixed(1)}, ${bolt.origPos.z.toFixed(1)}) mm`} onRemove={() => setBolts((items) => items.filter((item) => item.id !== bolt.id))} />
                ))}
              </ConstraintSection>
              <ConstraintSection title="Force Vectors" accent="#e06030" modeName="force" mode={mode} setMode={setMode} empty="No forces applied yet.">
                {forces.map((force) => (
                  <ItemRow
                    key={force.id}
                    color="#e06030"
                    title={`${force.label} - ${force.magnitude} N`}
                    detail={`dir (${force.dir.join(", ")}) at (${force.origPos.x.toFixed(1)}, ${force.origPos.y.toFixed(1)}, ${force.origPos.z.toFixed(1)}) mm`}
                    onRemove={() => setForces((items) => items.filter((item) => item.id !== force.id))}
                  />
                ))}
              </ConstraintSection>
              {canAnalyze && <SecondaryButton onClick={() => setActiveTab("settings")}>Configure Print Settings</SecondaryButton>}
            </Panel>
          )}

          {activeTab === "settings" && (
            <Panel>
              <PanelTitle>PRINT SETTINGS</PanelTitle>
              <FieldLabel>Material</FieldLabel>
              <select value={settings.material} onChange={(event) => setSettings((current) => ({ ...current, material: event.target.value }))}>
                {MATERIALS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} - {item.tensile} MPa tensile
                  </option>
                ))}
              </select>
              <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 18 }}>
                {[["Tensile", `${material.tensile} MPa`], ["Flexural", `${material.flexural} MPa`], ["Density", `${material.density} g/cm3`]].map(([key, value]) => (
                  <MetricBox key={key} label={key} value={value} />
                ))}
              </div>
              {[
                { key: "infill", label: "Infill Density", min: 5, max: 100, step: 5, unit: "%" },
                { key: "layerHeight", label: "Layer Height", min: 0.1, max: 0.4, step: 0.05, unit: "mm" },
                { key: "wallCount", label: "Wall Perimeters", min: 1, max: 8, step: 1, unit: "" },
                { key: "nozzleDiameter", label: "Nozzle Diameter", min: 0.25, max: 0.8, step: 0.05, unit: "mm" },
                { key: "lineWidth", label: "Line Width", min: 0.3, max: 1, step: 0.05, unit: "mm" },
              ].map((item) => (
                <RangeSetting key={item.key} item={item} value={settings[item.key]} onChange={(value) => setSettings((current) => ({ ...current, [item.key]: value }))} />
              ))}
              <FieldLabel>Print Orientation</FieldLabel>
              <div style={{ display: "flex", gap: 5, marginBottom: 20 }}>
                {[["flat", "Flat (XY)"], ["upright", "Upright (Z)"], ["angled", "45 deg Angled"]].map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setSettings((current) => ({ ...current, orientation: value }))}
                    style={{
                      flex: 1,
                      padding: "7px 4px",
                      fontSize: 9,
                      background: settings.orientation === value ? "#1e1008" : "#0e0e11",
                      border: `1px solid ${settings.orientation === value ? "#e06030" : "#1a1a20"}`,
                      color: settings.orientation === value ? "#e06030" : "#444",
                      cursor: "pointer",
                      borderRadius: 3,
                      fontFamily: "inherit",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <FieldLabel>Layer Bond Quality</FieldLabel>
              <div style={{ display: "flex", gap: 5, marginBottom: 14 }}>
                {LAYER_ADHESION.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSettings((current) => ({ ...current, layerAdhesion: item.id }))}
                    style={{
                      flex: 1,
                      padding: "7px 4px",
                      fontSize: 9,
                      background: settings.layerAdhesion === item.id ? "#1e1008" : "#0e0e11",
                      border: `1px solid ${settings.layerAdhesion === item.id ? "#e06030" : "#1a1a20"}`,
                      color: settings.layerAdhesion === item.id ? "#e06030" : "#444",
                      cursor: "pointer",
                      borderRadius: 3,
                      fontFamily: "inherit",
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, fontSize: 9, letterSpacing: "0.12em", color: "#777", textTransform: "uppercase", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={settings.enclosure}
                  onChange={(event) => setSettings((current) => ({ ...current, enclosure: event.target.checked }))}
                  style={{ width: 13, height: 13 }}
                />
                Heated enclosure / well controlled cooling
              </label>
              <SummaryBox bolts={bolts} forces={forces} />
              <PrimaryButton onClick={runAnalysis} disabled={!canAnalyze || isAnalyzing}>
                {isAnalyzing ? "Analyzing..." : "Run FEA Estimate"}
              </PrimaryButton>
            </Panel>
          )}

          {activeTab === "results" && (
            <Panel>
              {isAnalyzing && <EmptyState title="RUNNING ANALYSIS" detail="Computing load paths and stress distribution..." />}
              {!isAnalyzing && !results && <EmptyState title="No results yet" detail="Run an analysis after placing constraints and forces." />}
              {!isAnalyzing && results?.error && <ErrorBox>{results.error}</ErrorBox>}
              {!isAnalyzing && results && !results.error && <Results results={results} onEdit={() => setActiveTab("constraints")} />}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({ children }) {
  return <div style={{ padding: 22 }}>{children}</div>;
}

function PanelTitle({ children }) {
  return <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 13, letterSpacing: "0.2em", color: "#333", marginBottom: 18 }}>{children}</div>;
}

function FieldLabel({ children }) {
  return <label style={{ fontSize: 9, letterSpacing: "0.14em", color: "#444", textTransform: "uppercase", display: "block", marginBottom: 7 }}>{children}</label>;
}

function InfoRow({ number, title, description }) {
  return (
    <div style={{ display: "flex", gap: 14, marginBottom: 14, padding: "12px 14px", background: "#0e0e11", border: "1px solid #1a1a20", borderRadius: 4 }}>
      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, color: "#1e1e24", minWidth: 28 }}>{number}</div>
      <div>
        <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "#b0a898", marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 9, color: "#444", lineHeight: 1.7 }}>{description}</div>
      </div>
    </div>
  );
}

function PrimaryButton({ children, disabled = false, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        marginTop: 4,
        width: "100%",
        padding: "12px",
        background: disabled ? "#1a1a20" : "#e06030",
        color: disabled ? "#333" : "#0a0a0c",
        fontSize: 10,
        letterSpacing: "0.15em",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        borderRadius: 3,
        fontFamily: "inherit",
        textTransform: "uppercase",
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: 20,
        width: "100%",
        padding: "10px",
        background: "transparent",
        border: "1px solid #e06030",
        color: "#e06030",
        fontSize: 10,
        letterSpacing: "0.15em",
        cursor: "pointer",
        borderRadius: 3,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function ConstraintSection({ title, accent, modeName, mode, setMode, empty, children }) {
  const count = Array.isArray(children) ? children.length : 0;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 9, letterSpacing: "0.15em", color: `${accent}88`, textTransform: "uppercase" }}>{title}</div>
        <button
          onClick={() => setMode((current) => (current === modeName ? "view" : modeName))}
          style={{
            padding: "4px 10px",
            fontSize: 9,
            letterSpacing: "0.1em",
            background: mode === modeName ? "#1a0e00" : "transparent",
            border: `1px solid ${mode === modeName ? accent : "#222"}`,
            color: mode === modeName ? accent : "#444",
            cursor: "pointer",
            borderRadius: 3,
            fontFamily: "inherit",
          }}
        >
          {mode === modeName ? "Placing..." : `Place ${modeName}`}
        </button>
      </div>
      {count === 0 ? <div style={{ fontSize: 9, color: "#2a2a2a", padding: "12px 14px", border: "1px dashed #1a1a20", borderRadius: 3, textAlign: "center" }}>{empty}</div> : children}
    </div>
  );
}

function ItemRow({ color, title, detail, onRemove }) {
  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#0e0e11", border: `1px solid ${color}18`, borderRadius: 3, marginBottom: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, color }}>{title}</div>
        <div style={{ fontSize: 8, color: "#444", marginTop: 2 }}>{detail}</div>
      </div>
      <button onClick={onRemove} aria-label={`Remove ${title}`} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>
        X
      </button>
    </div>
  );
}

function MetricBox({ label, value }) {
  return (
    <div style={{ flex: 1, background: "#0e0e11", border: "1px solid #1a1a20", borderRadius: 3, padding: "6px 8px" }}>
      <div style={{ fontSize: 7, color: "#333", letterSpacing: "0.1em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 10, color: "#777" }}>{value}</div>
    </div>
  );
}

function RangeSetting({ item, value, onChange }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
        <FieldLabel>{item.label}</FieldLabel>
        <span style={{ fontSize: 11, color: "#e06030" }}>
          {value}
          {item.unit}
        </span>
      </div>
      <input type="range" min={item.min} max={item.max} step={item.step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

function SummaryBox({ bolts, forces }) {
  return (
    <div style={{ background: "#0e0e11", border: "1px solid #1a1a20", borderRadius: 4, padding: "10px 14px", marginBottom: 16, fontSize: 9, color: "#444", lineHeight: 2 }}>
      <div style={{ color: "#333", marginBottom: 4, letterSpacing: "0.1em" }}>ANALYSIS INPUTS</div>
      <div>
        {bolts.length} bolt constraint{bolts.length === 1 ? "" : "s"} | {forces.length} force vector{forces.length === 1 ? "" : "s"}
      </div>
      {bolts.length === 0 && <div style={{ color: "#e0303066" }}>No bolt constraints. Go to Constraints tab.</div>}
      {forces.length === 0 && <div style={{ color: "#e0303066" }}>No forces applied. Go to Constraints tab.</div>}
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 0" }}>
      <div style={{ fontSize: 10, color: "#444", letterSpacing: "0.15em" }}>{title}</div>
      <div style={{ fontSize: 9, color: "#2a2a2a", marginTop: 8 }}>{detail}</div>
    </div>
  );
}

function ErrorBox({ children }) {
  return <div style={{ padding: 14, background: "#1a0808", border: "1px solid #e0303044", borderRadius: 4, color: "#e06060", fontSize: 10 }}>{children}</div>;
}

function Results({ results, onEdit }) {
  const riskStyle = SEVERITY[results.overallRisk] ?? SEVERITY.medium;
  const metrics = [
    { label: "Worst Safety Factor", value: results.safetyFactor?.toFixed(2) ?? "n/a", unit: "x", warn: results.safetyFactor < 1.5 },
    { label: "Layer Safety", value: results.layerSafetyFactor?.toFixed(2) ?? "n/a", unit: "x", warn: results.layerSafetyFactor < 1.5 },
    { label: "Bolt Bearing", value: results.bearingSafetyFactor?.toFixed(2) ?? "n/a", unit: "x", warn: results.bearingSafetyFactor < 1.5 },
    { label: "Buckling Safety", value: results.bucklingSafetyFactor?.toFixed(2) ?? "n/a", unit: "x", warn: results.bucklingSafetyFactor < 1.5 },
    { label: "Max Stress", value: results.maxStress?.toFixed(1) ?? "n/a", unit: "MPa" },
    { label: "Z Strength", value: results.zStrength?.toFixed(1) ?? "n/a", unit: "MPa" },
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 18 }}>
        {metrics.map((metric) => (
          <div key={metric.label} className="card" style={{ background: "#0e0e11", border: `1px solid ${metric.warn ? "#e0603033" : "#1a1a20"}`, borderRadius: 4, padding: "10px 12px" }}>
            <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "#333", textTransform: "uppercase", marginBottom: 5 }}>{metric.label}</div>
            <div style={{ fontSize: 20, fontFamily: "'Bebas Neue',sans-serif", color: metric.warn ? "#e06030" : "#b0a898", letterSpacing: "0.05em" }}>
              {metric.value} <span style={{ fontSize: 11, color: "#444" }}>{metric.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ background: riskStyle.bg, border: `1px solid ${riskStyle.color}28`, borderLeft: `3px solid ${riskStyle.color}`, borderRadius: "0 4px 4px 0", padding: "12px 14px", marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
          <span style={{ fontSize: 8, letterSpacing: "0.14em", color: "#444", textTransform: "uppercase" }}>Overall Assessment</span>
          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 2, letterSpacing: "0.1em", textTransform: "uppercase", background: riskStyle.bg, color: riskStyle.color, border: `1px solid ${riskStyle.color}44` }}>
            {results.overallRisk?.toUpperCase()}
          </span>
        </div>
        <div style={{ fontSize: 10, color: "#777", lineHeight: 1.75 }}>{results.summary}</div>
      </div>

      <div className="card" style={{ background: "#0e0e11", border: "1px solid #1a1a20", borderRadius: 4, padding: "12px 14px", marginBottom: 18 }}>
        <div style={{ fontSize: 8, letterSpacing: "0.15em", color: "#333", textTransform: "uppercase", marginBottom: 10 }}>FDM Material Model</div>
        {[
          ["Controlling mode", results.controllingMode],
          ["Effective in-plane strength", `${results.effectiveStrength?.toFixed(1) ?? "n/a"} MPa`],
          ["Estimated Z strength", `${results.zStrength?.toFixed(1) ?? "n/a"} MPa`],
          ["Wall thickness", `${results.wallThickness?.toFixed(2) ?? "n/a"} mm`],
          ["Shell contribution", `${((results.shellRatio ?? 0) * 100).toFixed(0)}%`],
          ["Layer peel stress", `${results.layerPeelStress?.toFixed(2) ?? "n/a"} MPa`],
        ].map(([label, value]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 9, color: "#555", lineHeight: 1.9 }}>
            <span>{label}</span>
            <span style={{ color: "#b0a898", textAlign: "right" }}>{value}</span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 8, letterSpacing: "0.15em", color: "#333", textTransform: "uppercase", marginBottom: 10 }}>Failure Modes</div>
        {(results.failureModes ?? []).map((failureMode, index) => {
          const severity = SEVERITY[failureMode.severity] ?? SEVERITY.medium;
          return (
            <div key={`${failureMode.name}-${index}`} className="card" style={{ background: severity.bg, borderLeft: `3px solid ${severity.color}`, border: `1px solid ${severity.color}1a`, borderRadius: "0 4px 4px 0", padding: "11px 13px", marginBottom: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: "#c0b8b0" }}>{failureMode.name}</span>
                <span style={{ fontSize: 8, padding: "1px 7px", borderRadius: 2, letterSpacing: "0.1em", textTransform: "uppercase", background: severity.bg, color: severity.color, border: `1px solid ${severity.color}44` }}>{failureMode.severity}</span>
              </div>
              <div style={{ fontSize: 8, color: "#44444a", letterSpacing: "0.08em", marginBottom: 5 }}>{failureMode.location}</div>
              <div style={{ fontSize: 9, color: "#555", lineHeight: 1.65, marginBottom: 7 }}>{failureMode.description}</div>
              <div style={{ fontSize: 9, color: "#907050", lineHeight: 1.65, borderTop: "1px solid #1e1e24", paddingTop: 7 }}>{failureMode.recommendation}</div>
            </div>
          );
        })}
      </div>

      {results.printRecommendations?.length > 0 && (
        <div className="card" style={{ background: "#0e0e11", border: "1px solid #1a1a20", borderRadius: 4, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 8, letterSpacing: "0.15em", color: "#333", textTransform: "uppercase", marginBottom: 10 }}>Print Recommendations</div>
          {results.printRecommendations.map((recommendation, index) => (
            <div key={recommendation} style={{ display: "flex", gap: 8, marginBottom: 7, fontSize: 9, color: "#555", lineHeight: 1.65 }}>
              <span style={{ color: "#e06030", minWidth: 12 }}>{index + 1}.</span>
              <span>{recommendation}</span>
            </div>
          ))}
        </div>
      )}

      <SecondaryButton onClick={onEdit}>Edit Constraints</SecondaryButton>
    </div>
  );
}
