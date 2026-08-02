import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (!new Set(["dev", "production"]).has(mode)) {
  throw new Error("Usage: node scripts/verify-build.mjs <dev|production>");
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = path.join(projectRoot, "dist");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".txt"]);
const debugMarkers = [
  "Development build",
  "Reveal current word",
  "Debug panel ready",
  "Account database",
  "accounts-dashboard",
  "dev/accounts",
  "data-dev-action",
  "dev-panel"
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

const files = await collectFiles(distDirectory);
const relativeFiles = files.map((file) => path.relative(distDirectory, file));
const debugNamedFiles = relativeFiles.filter((file) => /debug|dev-panel/i.test(file));
const markerMatches = [];

for (const file of files) {
  if (!textExtensions.has(path.extname(file))) continue;
  const contents = await readFile(file, "utf8");
  for (const marker of debugMarkers) {
    if (contents.includes(marker)) {
      markerMatches.push(`${path.relative(distDirectory, file)}: ${marker}`);
    }
  }
}

const hasDebugOutput = debugNamedFiles.length > 0 && markerMatches.length > 0;

if (mode === "dev" && !hasDebugOutput) {
  throw new Error("Development build is missing its debug module or markers.");
}

if (mode === "production" && (debugNamedFiles.length || markerMatches.length)) {
  throw new Error(
    `Production build contains debug output:\n${[
      ...debugNamedFiles,
      ...markerMatches
    ].join("\n")}`
  );
}

console.log(
  mode === "dev"
    ? "Verified: development debug tools are present."
    : "Verified: production debug tools are absent."
);
