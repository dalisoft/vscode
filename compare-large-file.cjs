// Isolate original strategies in the actual editor; always restore compiled output.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { transformSync } = require(path.join(process.cwd(), 'build/node_modules/esbuild'));
const evidence = path.join(__dirname, 'original-large-file');
fs.mkdirSync(evidence, { recursive: true });
const saved = new Map();
try {
  for (const file of ['baseRenderStrategy', 'fullFileRenderStrategy', 'viewportRenderStrategy']) {
    const source = `src/vs/editor/browser/gpu/renderStrategy/${file}.ts`;
    const output = source.replace(/^src\//, 'out/').replace(/\.ts$/, '.js');
    saved.set(output, fs.readFileSync(output));
    const contents = execFileSync('git', ['show', `HEAD^:${source}`], { encoding: 'utf8' });
    fs.writeFileSync(output, transformSync(contents, { loader: 'ts', format: 'esm', target: 'es2024', tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } }).code);
  }
  const capture = spawnSync(process.execPath, [path.join(__dirname, 'integrated-editor.cjs')], { env: { ...process.env, EVIDENCE_DIR: evidence }, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const log = (capture.stdout + capture.stderr).replaceAll(process.cwd(), '<checkout>');
  fs.writeFileSync(path.join(evidence, 'capture.log'), log);
  if (capture.error || capture.status === 0 || !log.includes('GPU capture failed') || !log.includes('ink=0')) throw Error(`Unexpected control result: ${capture.status}\n${log}`);
  console.log(log);
  console.log('Expected large-file failure reproduced; compiled strategy output restored.');
} finally {
  for (const [output, contents] of saved) fs.writeFileSync(output, contents);
}
