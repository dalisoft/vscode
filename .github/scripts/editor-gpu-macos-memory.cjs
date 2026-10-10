/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { _electron } = require(path.resolve('.build/smoke-tools/node_modules/playwright'));
(async () => {
 const evidence = path.resolve('.build/editor-gpu-smoke-evidence');
 const results = { sourceCommit: process.env.SOURCE_COMMIT, workload: '1800 generated JSON settings, Menlo 14, Quiet Light, forced native scale 2; isolated fresh processes for each mode', runs: [] };
 try {
  for (const mode of ['off', 'on']) {
   const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-gpu-memory-'));
   fs.mkdirSync(path.join(profile, 'user-data/User'), { recursive: true });
   fs.writeFileSync(path.join(profile, 'user-data/User/settings.json'), JSON.stringify({ 'editor.experimentalGpuAcceleration': mode, 'editor.fontFamily': 'Menlo', 'editor.fontSize': 14, 'editor.minimap.enabled': false, 'workbench.colorTheme': 'Quiet Light', 'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off' }));
   const fixture = path.join(profile, 'fixture.json');
   fs.writeFileSync(fixture, JSON.stringify(Object.fromEntries(Array.from({ length: 1800 }, (_, i) => [`editor.test${i}`, i % 2 ? 'memory test string' : true])), null, 2));
   const env = { ...process.env };
   for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'ELECTRON_RUN_AS_NODE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS']) delete env[key];
   let app;
   const run = { mode, samples: [], errors: [] };
   results.runs.push(run);
   try {
    app = await _electron.launch({ executablePath: path.resolve('.build/macos-app/Code - OSS.app/Contents/MacOS/Code - OSS'), env, timeout: 90000, args: [`--user-data-dir=${path.join(profile,'user-data')}`, `--extensions-dir=${path.join(profile,'extensions')}`, `--shared-data-dir=${path.join(profile,'shared-data')}`, '--force-device-scale-factor=2', '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--new-window', fixture] });
    const page = await app.firstWindow({ timeout: 90000 });
    page.on('pageerror', e => run.errors.push(e.message));
    await page.locator('.monaco-workbench').waitFor({ timeout: 90000 });
    await page.waitForFunction(() => document.querySelector('.monaco-editor .view-lines'));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    async function sample(name) {
     const native = await app.evaluate(({ app, webContents }) => ({ metrics: app.getAppMetrics(), contents: webContents.getAllWebContents().filter(w => w.getType() === 'window').map(w => ({ pid: w.getOSProcessId() })) }));
     const pids = native.metrics.map(m => m.pid);
     const rss = execFileSync('/bin/ps', ['-p', pids.join(','), '-o', 'pid=,rss=,comm='], { encoding: 'utf8' });
     const metrics = await cdp.send('Performance.getMetrics');
     const heap = await cdp.send('Runtime.getHeapUsage');
     const surface = await page.evaluate(() => ({ dpr: devicePixelRatio, canvases: [...document.querySelectorAll('.editorCanvas')].map(c => [c.width,c.height]), domChars: [...document.querySelectorAll('.monaco-editor .view-lines')].reduce((n,e) => n + e.textContent.trim().length,0) }));
     run.samples.push({ name, native, rss, heap, metrics: metrics.metrics.filter(m => /JSHeap|Nodes|Documents|Frames/.test(m.name)), surface });
    }
    await page.waitForTimeout(60000);
    await sample('idle60s');
    for (let i=0; i<5; i++) {
     await page.keyboard.press('Control+g');
     const input = page.locator('.quick-input-widget input').first();
     await input.fill(i % 2 ? ':100' : ':1500');
     await input.press('Enter');
     await page.waitForTimeout(1000);
    }
    await sample('after5Scrolls');
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(5000);
    await sample('afterExplicitGC');
    await page.screenshot({ path: path.join(evidence, `memory-${mode}.png`) });
    if (run.errors.length) throw Error(run.errors.join('\n'));
   } finally { await app?.close(); fs.rmSync(profile, { recursive: true, force: true }); }
  }
  console.log(JSON.stringify(results, null, 2));
 } finally { fs.writeFileSync(path.join(evidence,'memory-observations.json'),JSON.stringify(results,null,2)+'\n'); }
})().catch(e => { console.error(e); process.exitCode=1; });
