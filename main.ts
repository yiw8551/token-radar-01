// Token launch radar (token-radar-01): the entrypoint.
//
// Reads the sealed DefiLlama snapshot, ranks every pre-token protocol the radar covers
// with the derived model in lib/model.ts, and writes the hand-in to the output directory:
//   board.json    the ranked board (the gate reads this)
//   data.js       the same board, as the dashboard's data file
//   dashboard/    a copy of this repository's dashboard/
//   screenshots/  a copy of this repository's screenshots/
//   dossier.json  buildDossier's summary of the two directories above, written last
//
// Input and output resolve the way the grader mounts them, with local stand-ins:
//   node main.ts --input <snapshot.json|dir>     (default /input)
//   MAKEFUN_OUTPUT_DIR=<dir> node main.ts        (default output /output)

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

/** Read `--name value` or `--name=value` from argv, else the fallback. */
function argument(name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at !== -1 && process.argv[at + 1] !== undefined) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`${flag}=`));
  return joined === undefined ? fallback : joined.slice(flag.length + 1);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = argument('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = argument('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { rows, data } = buildBoard(snapshot);
const issue = boardIssue(rows, snapshot);
if (issue !== null) fail(`the model produced a board the gate refuses: ${issue}`);

/** Copy a directory's plain files (dot-names skipped) into the output, returning the names. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    names.push(name);
  }
  return names;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows }, null, 1)}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(data));

const pageFiles = copyTree(join(root, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyTree(join(root, 'screenshots'), join(outDir, 'screenshots'));
if (pageFiles.length < 3) fail(`dashboard/ copied ${pageFiles.length} files: index.html, a .css and a .js are required`);
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images: hand in 3 (board, detail, filtered)`);

// The dossier refuses a badly named or oversize screenshot; fail here with the file named
// instead, while the fix is still a local one.
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const bytes = statSync(join(outDir, 'screenshots', name)).size;
  if (bytes > 524_288) fail(`screenshots/${name}: ${bytes} bytes is past the 512 KiB cap`);
}

// The dossier goes last: the scorer rebuilds it from this same output and compares bytes.
const dossier = buildDossier(outDir, {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

const beyond = rows.filter((r) => !r.watchlist).length;
process.stdout.write(
  `token radar: snapshot of ${snapshot.as_of}: ${snapshot.protocols.length} protocols, ` +
    `${snapshot.watchlist.length} on the watchlist\n` +
    `token radar: board holds ${rows.length} pre-token rows (${snapshot.watchlist.length} watchlist + ${beyond} beyond it), ` +
    `top row ${rows[0]!.slug} at $${rows[0]!.implied_value_usd.toLocaleString('en-US')}\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length} images) and dossier.json to ${outDir}\n`,
);
