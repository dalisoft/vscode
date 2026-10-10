// Run from the source checkout after npm run build-fast -- --client-only.
// Linux requires a display (for example Xvfb). This exercises the editor, not the full workbench.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(path.join(process.cwd(), 'node_modules/@playwright/test'));
const root = process.cwd();
const evidence = path.resolve(process.env.EVIDENCE_DIR || __dirname);
fs.mkdirSync(evidence, { recursive: true });
const css = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.css')) css.push('/' + path.relative(root, file));
  }
}
walk(path.join(root, 'out'));
const imports = Object.fromEntries(css.map(url => [url, 'data:text/javascript,' + encodeURIComponent(`globalThis._VSCODE_CSS_LOAD(${JSON.stringify(url)});`)]));
const html = `<!doctype html><meta charset="utf-8"><style>html,body,#editor{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="editor"></div>
<script>globalThis._VSCODE_CSS_LOAD=url=>{const link=document.createElement('link');link.rel='stylesheet';link.href=url;document.head.append(link);};</script>
<script type="importmap">${JSON.stringify({ imports })}</script>`;
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const file = req.url === '/font.ttf' ? path.join(__dirname, 'font.ttf') : path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.ttf') ? 'font/ttf' : 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const results = [];
  try {
    for (const dpr of [1, 1.25, 2]) {
      // Native browser scale: emulated DPR does not resize ResizeObserver devicePixelContentBox.
      const args = [`--force-device-scale-factor=${dpr}`, '--window-size=1100,800'];
      if (process.env.SOFTWARE_WEBGPU === '1') args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface');
      const browser = await chromium.launch({ headless: false, executablePath: process.env.CHROMIUM_PATH || undefined, args });
      try {
        const context = await browser.newContext({ viewport: null });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.evaluate(async () => {
          const font = await new FontFace('TestMono', 'url(/font.ttf)').load();
          document.fonts.add(font);
          const monaco = await import('/out/vs/editor/editor.api.js');
          const { StandaloneServices } = await import('/out/vs/editor/standalone/browser/standaloneServices.js');
          const { IStandaloneThemeService } = await import('/out/vs/editor/standalone/common/standaloneTheme.js');
          // Standalone themes expose an empty GPU palette. Supply the same theme's token colors.
          // VS Code workbench themes provide this accessor already. No production code is changed.
          const theme = StandaloneServices.get(IStandaloneThemeService).getColorTheme();
          Object.defineProperty(theme, 'tokenColorMap', { get: () => theme.tokenTheme.getColorMap().map(color => color?.toString()) });
          globalThis.editor = monaco.editor.create(document.getElementById('editor'), {
            value: Array.from({ length: 60000 }, (_, i) => `const line${i + 1} = "GPU renderer large-file test";`).join('\n'),
            language: 'plaintext', theme: 'vs', experimentalGpuAcceleration: 'on',
            fontFamily: 'TestMono', fontSize: 14, lineHeight: 24, minimap: { enabled: false },
            automaticLayout: true, scrollBeyondLastLine: false
          });
          const { ViewGpuContext } = await import('/out/vs/editor/browser/gpu/viewGpuContext.js');
          const device = await ViewGpuContext.device;
          globalThis.gpuErrors = [];
          device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
        });
        await page.waitForFunction(() => editor._modelData.view._viewLinesGpu._initialized);
        const snapshots = [];
        for (const name of ['top', 'line50000', 'delete', 'undo', 'resize', 'return']) {
          await page.evaluate(async name => {
            if (name === 'line50000') editor.revealLineInCenter(50000);
            if (name === 'delete') {
              editor.pushUndoStop();
              editor.executeEdits('capture', [{ range: { startLineNumber: 49999, startColumn: 1, endLineNumber: 50002, endColumn: 1 }, text: '' }]);
              editor.pushUndoStop();
            }
            if (name === 'undo') await editor.getModel().undo();
            if (name === 'resize') { document.getElementById('editor').style.width = '800px'; editor.layout(); }
            if (name === 'return') editor.revealLineInCenter(100);
            editor.render(true);
          }, name);
          await page.waitForTimeout(400);
          const data = await page.evaluate(() => {
            const renderer = editor._modelData.view._viewLinesGpu;
            const texture = renderer._atlasStorage.texture;
            const canvas = document.querySelector('.editorCanvas');
            const contentLeft = editor.getLayoutInfo().contentLeft;
            return { devicePixelRatio, domText: document.querySelector('.view-lines').textContent,
              scrollTop: editor.getScrollTop(), canvas: [canvas.width, canvas.height],
              atlas: [texture.width, texture.height, texture.depthOrArrayLayers], strategy: renderer._renderStrategy.value.type,
              visible: [renderer._lastViewportData.startLineNumber, renderer._lastViewportData.endLineNumber],
              delta: renderer._lastViewportData.bigNumbersDelta, contentLeft };
          });
          const png = await page.screenshot({ path: path.join(evidence, `editor-gpu-${dpr}-${name}.png`) });
          const ink = await page.evaluate(async ({ png, left }) => {
            const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' }));
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
            const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
            let ink = 0;
            for (let y = 0; y < bitmap.height - 30 * devicePixelRatio; y++) for (let x = Math.ceil(left * devicePixelRatio); x < Math.min(bitmap.width - 30 * devicePixelRatio, 760 * devicePixelRatio); x++) {
              const index = (y * bitmap.width + x) * 4;
              if (pixels[index] < 150 && pixels[index + 1] < 150 && pixels[index + 2] < 150) ink++;
            }
            bitmap.close(); return ink;
          }, { png: png.toString('base64'), left: data.contentLeft });
          delete data.contentLeft;
          if (Math.abs(data.devicePixelRatio - dpr) > 0.01 || !ink || data.domText) throw Error(`GPU capture failed: ${JSON.stringify(data)}, ink=${ink}`);
          snapshots.push({ name, ...data, ink });
        }
        errors.push(...await page.evaluate(() => gpuErrors));
        if (errors.length) throw Error(errors.join('\n'));
        results.push({ dpr, snapshots, errors });
      } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(evidence, 'editor-gpu-integration.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify(results, null, 2));
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
