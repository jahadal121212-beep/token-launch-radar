// Token launch radar, model radar-2 (Node 22, standard library only).
//
// The program reads the sealed snapshot (from /input/snapshot.json, or
// --input <file|dir>), scores every rankable pre-token protocol with the
// comps-anchored model in lib/model.ts, writes the ranked board to
// /output/board.json, and writes the dashboard's data to /output/data.js.
// It copies this repository's dashboard/ to /output/dashboard, decodes the
// base64 screenshot sources in screenshots/ into real PNGs in
// /output/screenshots (the repository carries the shots as text, because the
// entry travels as text files), and writes /output/dossier.json with the
// vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: it reads
// /output/data.js and renders the board, the detail view and the live-token
// view from it. The program runs twice and writes the same bytes both times.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** The snapshot file: --input, the sealed /input, or a local input/ directory. */
function findInput(): string {
  const given = arg('input', '');
  const candidates: string[] = [];
  if (given !== '') candidates.push(given.endsWith('.json') ? given : join(given, 'snapshot.json'));
  candidates.push('/input/snapshot.json', join(here, 'input', 'snapshot.json'));
  for (const c of candidates) if (existsSync(c)) return c;
  process.stderr.write(`token radar: no snapshot found: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}

const inputFile = findInput();
const out = arg('output', arg('out', process.env.MAKEFUN_OUTPUT_DIR ?? '/output'));

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (dashFiles.length < 3 || !dashFiles.includes('index.html')) {
  process.stderr.write(`token radar: dashboard/ holds ${dashFiles.length} files: hand in index.html, a .css and a .js\n`);
  process.exit(1);
}

/** A PNG's pixel size out of its IHDR chunk, or null when the bytes are not a PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 33) return null;
  for (let i = 0; i < PNG_MAGIC.length; i++) if (bytes[i] !== PNG_MAGIC[i]) return null;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Decode the screenshot sources in screenshots/ (one base64 text file per shot,
 * `<name>.png.b64`) into real PNGs in /output/screenshots. The repository carries
 * the shots as text so the entry travels as text files; the gate reads the
 * decoded PNGs, never the sources.
 */
function decodeScreenshots(from: string, to: string): string[] {
  if (!existsSync(from)) {
    process.stderr.write('token radar: no screenshots/ directory: hand in 3 shots, the board, a detail view and a filtered view\n');
    process.exit(1);
  }
  mkdirSync(to, { recursive: true });
  const written: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.') || !name.endsWith('.png.b64')) continue;
    const outName = name.slice(0, -4);
    if (!IMAGE_NAME.test(outName)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
    const text = readFileSync(join(from, name), 'utf8').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length === 0) {
      process.stderr.write(`token radar: screenshots/${name} is not base64 text\n`);
      process.exit(1);
    }
    const bytes = Buffer.from(text, 'base64');
    const size = pngSize(bytes);
    if (size === null) {
      process.stderr.write(`token radar: screenshots/${name} does not decode to a PNG\n`);
      process.exit(1);
    }
    if (bytes.length > SCREENSHOT_CAPS.max_bytes) {
      process.stderr.write(`token radar: screenshots/${outName} is ${bytes.length} bytes, over the ${SCREENSHOT_CAPS.max_bytes} cap\n`);
      process.exit(1);
    }
    if (Math.max(size.width, size.height) > 1440 || Math.min(size.width, size.height) < 800) {
      process.stderr.write(`token radar: screenshots/${outName} is ${size.width}x${size.height}: long side at most 1440, short side at least 800\n`);
      process.exit(1);
    }
    writeFileSync(join(to, outName), bytes);
    written.push(outName);
  }
  return written;
}

const shots = decodeScreenshots(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > SCREENSHOT_CAPS.max) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} shots: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
