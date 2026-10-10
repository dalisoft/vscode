/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require(path.resolve('.build/smoke-tools/node_modules/playwright'));

(async () => {
	const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-gpu-smoke-'));
	const evidence = path.resolve('.build/editor-gpu-smoke-evidence');
	fs.mkdirSync(path.join(profile, 'user-data/User'), { recursive: true });
	fs.mkdirSync(path.join(profile, 'extensions'));
	fs.writeFileSync(path.join(profile, 'user-data/User/settings.json'), JSON.stringify({
		'editor.experimentalGpuAcceleration': 'on',
		'editor.fontFamily': 'Menlo',
		'editor.fontSize': 14,
		'editor.minimap.enabled': false,
		'workbench.colorTheme': 'Quiet Light',
		'workbench.startupEditor': 'none',
		'files.simpleDialog.enable': true,
		'telemetry.telemetryLevel': 'off',
		'window.title': 'Editor GPU packaged build verification'
	}));
	const fixture = path.join(profile, 'editor-gpu-60000.txt');
	fs.writeFileSync(fixture, Array.from({ length: 60000 }, (_, i) => `const line${i + 1} = "GPU renderer large-file test";`).join('\n'));
	const env = { ...process.env };
	for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'ELECTRON_RUN_AS_NODE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS']) delete env[key];
	let app;
	const errors = [];
	const results = { sourceCommit: process.env.SOURCE_COMMIT, architecture: process.arch, snapshots: [], errors };
	try {
		app = await _electron.launch({
			executablePath: path.resolve('.build/macos-app/Code - OSS.app/Contents/MacOS/Code - OSS'),
			env, timeout: 90000,
			args: [
				`--user-data-dir=${path.join(profile, 'user-data')}`,
				`--extensions-dir=${path.join(profile, 'extensions')}`,
				`--shared-data-dir=${path.join(profile, 'shared-data')}`,
				'--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--new-window', fixture
			]
		});
		const page = await app.firstWindow({ timeout: 90000 });
		page.on('pageerror', error => errors.push(error.message));
		page.on('console', message => {
			if (message.type() === 'error' && /GPUValidation|WebGPU|GPUDevice|shader/i.test(message.text())) errors.push(message.text());
		});
		await page.locator('.monaco-workbench').waitFor({ timeout: 90000 });
		await page.waitForFunction(() => document.querySelector('.editorCanvas')?.width > 0, undefined, { timeout: 90000 });
		results.electron = await app.evaluate(() => process.versions.electron);
		results.gpuFeatureStatus = await app.evaluate(({ app }) => app.getGPUFeatureStatus());
		results.adapter = await page.evaluate(async () => {
			const adapter = await navigator.gpu?.requestAdapter();
			return adapter ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : null;
		});
		if (!results.adapter || results.gpuFeatureStatus.webgpu !== 'enabled') throw Error('Native WebGPU adapter unavailable; GPU verification cannot pass');
		for (const name of ['top', 'line50000']) {
			if (name === 'line50000') {
				await page.keyboard.press('Control+g');
				const input = page.locator('.quick-input-widget input').first();
				await input.waitFor({ state: 'visible' });
				// Quick access dispatches by prefix; keep ':' to select Go to Line.
				await input.fill(':50000');
				await input.press('Enter');
				await page.waitForFunction(() => Array.from(document.querySelectorAll('.line-numbers')).some(node => node.textContent.trim() === '50000'));
			}
			await page.waitForTimeout(1000);
			const state = await page.evaluate(() => {
				const canvas = document.querySelector('.editorCanvas');
				const editor = canvas.closest('.monaco-editor');
				const rect = canvas.getBoundingClientRect();
				return { devicePixelRatio, canvas: [canvas.width, canvas.height],
					domText: editor.querySelector('.view-lines').textContent.replace(/\s/g, ''),
					lineNumbers: Array.from(editor.querySelectorAll('.line-numbers')).map(node => node.textContent.trim()),
					rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } };
			});
			const png = await page.screenshot({ path: path.join(evidence, `${name}.png`) });
			// Measure the upper text region only, excluding gutter and notification overlays.
			const ink = await page.evaluate(async ({ png, rect }) => {
				const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' }));
				const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
				const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
				const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
				let ink = 0;
				for (let y = Math.ceil(rect.top * devicePixelRatio); y < Math.min(bitmap.height, Math.floor(Math.min(rect.bottom - 20, rect.top + 300) * devicePixelRatio)); y++) {
					for (let x = Math.ceil((rect.left + 120) * devicePixelRatio); x < Math.min(bitmap.width, Math.floor((rect.right - 30) * devicePixelRatio)); x++) {
						const offset = (y * bitmap.width + x) * 4;
						if (pixels[offset] < 150 && pixels[offset + 1] < 150 && pixels[offset + 2] < 150) ink++;
					}
				}
				bitmap.close(); return ink;
			}, { png: png.toString('base64'), rect: state.rect });
			results.snapshots.push({ name, ...state, ink });
			if (ink < 1000 || state.domText) throw Error(`Packaged GPU capture failed: ${JSON.stringify(state)}, ink=${ink}`);
		}
		if (errors.length) throw Error(errors.join('\n'));
		console.log(JSON.stringify(results, null, 2));
	} finally {
		fs.writeFileSync(path.join(evidence, 'observations.json'), JSON.stringify(results, null, 2) + '\n');
		await app?.close();
		fs.rmSync(profile, { recursive: true, force: true });
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
