// Run from the fix checkout after building client output. Stops on an unexpected result.
// Only compiled output is changed; every file is restored in a finally block.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { transformSync } = require(path.join(process.cwd(), 'build/node_modules/esbuild'));
const evidence = path.resolve(process.argv[2] || '.agent-validation/publish');
fs.mkdirSync(evidence, { recursive: true });
const prefix = 'src/vs/editor/browser/gpu/';
const outputPath = source => source.replace(/^src\//, 'out/').replace(/\.ts$/, '.js');
const original = source => execFileSync('git', ['show', `HEAD^:${source}`], { encoding: 'utf8' });
const cases = [
  { name: 'strategy-original', files: ['renderStrategy/baseRenderStrategy.ts', 'renderStrategy/fullFileRenderStrategy.ts', 'renderStrategy/viewportRenderStrategy.ts'], selector: '--run', run: 'src/vs/editor/test/browser/gpu/renderStrategy.test.ts', failing: 8 },
  { name: 'alpha-original', files: ['gpuUtils.ts'], selector: '--run', run: 'src/vs/editor/test/browser/gpu/gpuRendering.test.ts', failing: 1 },
  { name: 'font-original', files: ['raster/glyphRasterizer.ts'], selector: '--run', run: 'src/vs/editor/test/browser/gpu/glyphRasterizer.test.ts', failing: 2 },
  { name: 'fixed-suite', files: [], selector: '--runGlob', run: '**/editor/test/browser/gpu/**/*.test.js', failing: 0 }
];
const results = [];
for (const control of cases) {
  const saved = new Map();
  try {
    for (const relative of control.files) {
      const source = prefix + relative;
      const output = outputPath(source);
      saved.set(output, fs.readFileSync(output));
      let contents;
      if (relative === 'gpuUtils.ts') {
        // This helper did not exist before the fix; restore only the old alpha factor.
        contents = fs.readFileSync(source, 'utf8').replace("alpha: { srcFactor: 'one'", "alpha: { srcFactor: 'src-alpha'");
        if (contents === fs.readFileSync(source, 'utf8')) throw Error('Alpha control did not change the factor');
      } else {
        contents = original(source);
      }
      fs.writeFileSync(output, transformSync(contents, { loader: 'ts', format: 'esm', target: 'es2024', tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } }).code);
    }
    const command = ['run', 'test-browser-no-install', '--', '--browser', 'chromium', control.selector, control.run];
    const test = spawnSync('npm', command, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    let log = test.stdout + test.stderr;
    // Drop the very long debugger link (embedded source maps), retaining assertions and results.
    log = log.split('\n').filter(line => !line.includes('To debug, open') && !line.includes('debug.html?')).join('\n');
    log = log.replaceAll(process.cwd(), '<checkout>');
    fs.writeFileSync(path.join(evidence, `${control.name}.log`), log);
    const failureCount = Number(/(\d+) failing/.exec(log)?.[1] || 0);
    if (test.error || failureCount !== control.failing || (control.failing === 0 ? test.status !== 0 : test.status === 0)) {
      throw Error(`Unexpected ${control.name} result: ${test.status}, ${failureCount} failures\n${log}`);
    }
    results.push({ name: control.name, command: `npm ${command.join(' ')}`, exitCode: test.status, failureCount });
  } finally {
    for (const [output, contents] of saved) fs.writeFileSync(output, contents);
  }
}
fs.writeFileSync(path.join(evidence, 'negative-controls.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
