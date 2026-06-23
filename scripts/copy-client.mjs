// Copies the static client into dist/client so `npm start` serves the
// SAME client that lives in source. Without this, dist/client drifts every
// time client/index.html is edited, and the server silently serves a stale UI.
// Cross-platform (no shell cp): works on Windows, macOS, Linux.
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "client");
const dest = join(root, "dist", "client");

if (!existsSync(src)) {
  console.error("[copy-client] missing client/ directory at", src);
  process.exit(1);
}

// Wipe dest first so deleted/renamed files don't linger (this is what
// produced the doubly-nested dist/client/client/ junk).
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

console.log("[copy-client] copied client/ -> dist/client/");
