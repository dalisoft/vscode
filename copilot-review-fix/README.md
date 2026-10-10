# Copilot review follow-up

Source: `228e79ffc4715b96a7475f63cd34d57939c07864` on PR [#340836](https://github.com/microsoft/vscode/pull/340836), compared with source `bdc89a4a`.

Both review comments identified redundant scroll-uniform uploads. Each strategy records the device pixel ratio of its last successful scroll upload. `update()` uploads only when this value is uninitialized/changed or `bigNumbersDelta` changes. Scroll events still upload immediately and record the ratio, avoiding another upload on the following unchanged update. The full-file cache still invalidates when its coordinate origin changes. Display-scale changes retain correct scaled offsets.

## Verification

- Four added cases fail on the previous implementations: 11 passing / 4 failing. The cases count actual mocked queue uploads per scroll buffer, and assert values during initialization, unchanged frames, a scroll event, origin transitions in both directions, and a scroll event before the first update.
- The final Chromium GPU suite passes **56 tests**, with two pre-existing disabled allocator cases. The actual WebGPU production-WGSL readback test ran and passed.
- **18 real integrated-editor capture states** pass at native browser scales 1 / 1.25 / 2: top, line 50,000, delete, undo, resize, return. The content-area ink oracle excludes the gutter; DOM text fallback is empty; no captured page or GPU errors.
- Four additional **live pixel-ratio uniform checks** pass: full-file and viewport strategies at 1 → 2 → 1. The CDP scale change is followed by the real production `renderText` path; these assert uniform values, not native display-scale screenshot correctness.
- Targeted ESLint for the three changed files and `git diff --check` pass. A fresh client transpile supplied the test output; no broad typecheck was needed for this follow-up.

## Reproduce

Place this evidence folder inside the source checkout (for example `.agent-validation/copilot-review-fix`), then use the repository Node version and fresh client output. GPU tests require an available adapter. This Linux environment uses pinned Playwright Chromium, extracted system libraries, Xvfb and software WebGPU. `provenance.json` records the flags and versions.

```sh
npm run build-fast -- --client-only
npm run test-browser-no-install -- --browser chromium --runGlob '**/editor/test/browser/gpu/**/*.test.js'
npm run eslint -- src/vs/editor/browser/gpu/renderStrategy/fullFileRenderStrategy.ts src/vs/editor/browser/gpu/renderStrategy/viewportRenderStrategy.ts src/vs/editor/test/browser/gpu/renderStrategy.test.ts
SOFTWARE_WEBGPU=1 EVIDENCE_DIR=<capture-directory> CHROMIUM_PATH=<full-chromium-binary> node <this-folder>/integrated-editor.cjs
SOFTWARE_WEBGPU=1 EVIDENCE_DIR=<scale-check-directory> CHROMIUM_PATH=<full-chromium-binary> node <this-folder>/live-scale.cjs
```

The headed capture harness supplies the same standalone theme palette as the previous harness and uses actual native browser scaling. The original launch flags failed here with both revisions: stderr records absent Vulkan surface extensions followed by inability to create the WebGPU swap-buffer shared image. The successful launch uses `--use-angle=swiftshader` and `VulkanFromANGLE`. That change is only in the evidence harness; production browser startup is unchanged. The initial failures are retained rather than counted as passes.

The published macOS test app, previous native Mac tests, and memory measurements remain tied to `bdc89a4a`. No new Mac build or memory result is claimed. This follow-up removes redundant queue work; it does not establish a speedup or resolve the open total-memory acceptance question.

AI-assisted implementation, investigation and verification: OpenAI Codex under @dalisoft direction. Hashes are in the root `SHA256SUMS.txt`.
