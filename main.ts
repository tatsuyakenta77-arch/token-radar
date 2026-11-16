// A token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every rankable pre-token protocol with the calibrated model in
// lib/model.ts, writes the ranked board to /output/board.json and the
// dashboard's data to /output/data.js, copies this repository's dashboard/
// and screenshots/ into /output, and writes /output/dossier.json last with
// the vendored make.fun library — the summary the judge reads.
//
// The program only ever creates files inside the output directory. It never
// removes the output directory itself: in the grader /output is a mount under
// a read-only root, and removing it fails the run. It is fully deterministic:
// the same snapshot bytes always produce the same output bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The gate's own caps: the text cap shapes the dossier, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> (or --name=<value>) out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

// Only ever create inside the output directory; never remove the directory itself.
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/**
 * Copy a directory tree's regular files into `to`, skipping dot-names and
 * dot-directories, in sorted order so the copy is deterministic.
 */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const path = join(dir, name);
      const target = join(to, rel, name);
      const st = statSync(path);
      if (st.isDirectory()) {
        mkdirSync(target, { recursive: true });
        walk(path, rel === '' ? name : `${rel}/${name}`);
      } else if (st.isFile()) {
        if (!PLAIN_NAME.test(name)) fail(`${rel === '' ? name : `${rel}/${name}`}: a name is letters, digits and . _ -, 1 to 128 characters`);
        copyFileSync(path, target);
        copied.push(rel === '' ? name : `${rel}/${name}`);
      }
    }
  };
  walk(from, '');
  return copied;
}

const dashboardFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/ holds no index.html');
if (!dashboardFiles.some((f) => f.endsWith('.css'))) fail('dashboard/ holds no .css file');
if (!dashboardFiles.some((f) => f.endsWith('.js'))) fail('dashboard/ holds no .js file');

const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3 or 4, the board, a detail view and the model panel`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${radar.early_size} early finds, ${radar.set_aside} pre-token records set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
