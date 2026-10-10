# Editor WebGPU regression evidence

Source: `bdc89a4aa6d4e412e43e5e8ac868a79cbe1e83b7`, based on upstream main `04861ffb`.
Linux captures and controls were generated at `6b7eeb61`, then reused after rebasing: the entire editor tree, base tree, theme tree, Node version and dependency lockfiles are byte-identical. macOS builds use the final rebased source above. The source fix changes 13 files. This separate evidence branch retains the automated investigation and captures.

Implementation, investigation, tests and automated validation were generated with OpenAI Codex under @dalisoft's direction. The contributor reports glyphs and scrolling working on an M1 Max. Broader visual and memory acceptance remains open; automated platforms are identified below.

## What failed and why

1. **Faint text:** the WebGPU canvas uses premultiplied alpha, while the shader returns straight RGBA. Color blending correctly multiplies RGB by source alpha, but the old alpha factor also multiplied alpha by itself. An input alpha of 128/255 became 64/255. The correction keeps color blending and uses `one` for the source alpha factor. Both glyph and rectangle pipelines use the same definition.
2. **Excessive draws:** each cell has six floats; both strategies treated float count as instance count. They submitted six times the intended instances. Full-file rendering could expose cached rows beyond the viewport; viewport rendering could read beyond available cell storage. The correction uses cell counts, with byte counts retained for buffer uploads.
3. **Disappearing text in large files:** glyph positions are relative to `ViewportData.bigNumbersDelta`, but the scroll uniform was absolute. Around line 50,000 the inconsistent origins move the text offscreen. Both uniforms now use the same relative origin; the full-file cache is invalidated when that origin changes.
4. **Cache and resource lifetime:** DOM fallback cleared a row without removing its cached status. Disposed strategies remained registered as view event handlers. Growing viewport buffers retained disposal references and were destroyed twice. The correction invalidates those rows, unregisters handlers, and replaces allocations through `MutableDisposable`. Insert/delete handling also clears stale rows independently in both CPU buffers.
5. **Fractional font size:** only canvas dimensions need integer rounding. Rounding the font itself changed 13.3 px to 14 px and 17.5 px to 18 px. The rasterizer now preserves the fractional font size.
6. **Fixed atlas allocation:** each editor previously allocated GPU texture storage for 16 pages immediately. Storage now starts at one layer, grows in powers of two to fit the populated atlas, and can shrink after clearing. Resizing replaces both texture and glyph buffer, rebuilds bindings, invalidates upload versions, and reuploads populated pages. A one-layer texture explicitly uses a `2d-array` view. WGSL metadata storage uses a runtime outer array.

## Automated checks

| Check | Result | Artifact |
| --- | --- | --- |
| Pinned Chromium GPU suite | 52 passing, two pre-existing disabled allocator cases | `fixed-suite.log` |
| Original strategy implementations | Eight failing, three passing; wrapping and the simple delete/undo sequence already pass on the original | `strategy-original.log` |
| Original alpha factor | One failing: RGBA `[128, 0, 0, 64]` instead of `[128, 0, 0, 128]` | `alpha-original.log` |
| Original font rounding | Two failures at 0.95 and 1.25 density; exact-size 1.5 and 2 cases pass | `font-original.log` |
| Targeted TypeScript check | No diagnostics | `typecheck.log`, `typecheck-config.json` |
| ESLint, all 13 changed TypeScript files | Pass | `eslint.log` |
| Source diff whitespace check | Pass | `diff-check.log` |
| Actual integrated editor, 60,000 lines | 18 rendered states at native display scales 1, 1.25 and 2; no captured page/GPU errors and no DOM text fallback | `editor-gpu-integration.json`, `editor-gpu-integration.log`, PNG captures |
| Original strategies in the same integrated editor | Text disappears around line 50,000: zero content text pixels despite an empty DOM fallback; fixed capture contains 29,508 | `original-large-file/capture.log`, before/after PNGs |
| Isolated alpha compositor | Eight light/dark and density combinations; corrected alpha error zero and zero pixels above the two-channel-level tolerance | `webgpu-results.json`, `webgpu-comparison.png` |

The GPU pixel regression test uses the actual production WGSL and atlas storage. It checks readback through growth and shrink (page counts 1 → 3 → 1), including validation errors. It ran successfully in the Linux suite; it did not skip. Mock-based strategy tests exercise CPU cache state, upload contents, uniform origins, draw arguments and disposal counts. Allocation tests cover capacity reuse, dimension changes, growth, shrink and disposal.

The compositor illustration uses a small independent shader to isolate the blend equation; it is not a screenshot of the VS Code workbench. At DPR 1 the original blend differs from the expected composite in 4,349 light-theme and 3,900 dark-theme pixels; at DPR 2 those counts are 13,239 and 12,559. Corrected results have zero pixels over the tolerance in all four cases. See `alpha-comparison.cjs` for the formula and thresholds.

### Integrated editor captures

The retained harness is `integrated-editor.cjs`. It uses the real standalone editor view and its production GPU implementation. It supplies the standalone theme instance's token palette from that same theme because the standalone accessor returns an empty array; the workbench theme supplies the palette normally. This adaptation changes no production file. It uses real native Chromium display scaling, not CDP DPR emulation, so `ResizeObserver.devicePixelContentBox` matches the rendering scale.

For each density, it captures the top of the file, line 50,000, deletion, undo, a width resize, and a return to line 100. Screenshots contain generated fixture text only. The viewport strategy is active in the large-file captures; the initial capture uses the full-file strategy. A browser screenshot supplies the actual presented pixels for the ink count; direct post-presentation canvas reads were not used as a rendering oracle.

Each snapshot records the actual DPR, canvas dimensions, empty DOM text content, visible line range, scroll position, coordinate delta, strategy, texture capacity and visible text pixel count. This checks that text is present, not exact CPU/GPU pixel equivalence. Cache contents and expected draw/uniform arguments are asserted separately by the unit tests. Native macOS visual quality and total-memory measurements remain for manual testing.

`compare-large-file.cjs` restores the three original strategy implementations in compiled output, retaining the corrected alpha and atlas allocation so the coordinate/draw behavior is isolated. The top capture contains text; the line-50,000 capture fails with `ink=0`, at scrollTop 1,199,619 and coordinate delta 999,984. It saves both screenshots and requires that failure before restoring compiled files in `finally`. The complete fixed suite was rerun successfully after this control. This independently demonstrates the large-file disappearance in the actual editor, beyond the mock-based uniform test.

### Memory accounting

These numbers describe allocated RGBA8 texture capacity, not total process memory or measured unified memory:

| Density / page size | Previous 16-layer capacity | New initial capacity | Capacity at the end of the retained six-state run |
| --- | --- | --- | --- |
| 1 / 1024 × 1024 | 64 MiB | 4 MiB | 32 MiB / 8 layers |
| 1.25 / 1024 × 1024 | 64 MiB | 4 MiB | 32 MiB / 8 layers |
| 2 / 2048 × 2048 | 256 MiB | 16 MiB | 64 MiB / 4 layers |

Glyph metadata is 5,000 entries × 24 bytes per layer: 120,000 bytes initially instead of 1,920,000 bytes. Both allocations may temporarily coexist during replacement; populated texture pages are reuploaded. The CPU atlas is shared but the GPU texture is allocated per editor. Capacity can still grow to 16 layers if usage requires it. No total-memory threshold or whole-UI speedup is inferred from these allocation figures.

## Reproducing checks

Use the repository's Node version, install its dependencies, and build client output:

```sh
npm run build-fast -- --client-only
npm run test-browser-no-install -- --browser chromium --runGlob '**/editor/test/browser/gpu/**/*.test.js'
```

The pixel test explicitly skips without an available WebGPU adapter. To reproduce all controls, place this evidence directory in `.agent-validation/publish` inside the exact source checkout and stop watch tasks before running:

```sh
node .agent-validation/publish/baseline-regressions.cjs
node_modules/.bin/tsc -p .agent-validation/publish/typecheck-config.json --pretty false
node .agent-validation/publish/alpha-comparison.cjs
SOFTWARE_WEBGPU=1 node .agent-validation/publish/integrated-editor.cjs
SOFTWARE_WEBGPU=1 node .agent-validation/publish/compare-large-file.cjs
```

The negative-control script restores every modified `out/` file in a `finally` block, verifies the expected failure counts, then reruns the complete fixed suite. It replaces only the three original strategy implementations, the old alpha factor, or the original rasterizer in each respective control. The new allocation interface is retained for the isolated alpha control.

Linux captures used a headed Chromium 149.0.7827.55 (Playwright revision 1228), Xvfb and SwiftShader Vulkan. The integrated harness enables the required software-WebGPU flags when `SOFTWARE_WEBGPU=1`; `CHROMIUM_PATH` can select an explicit full Chromium binary. Linux system libraries, fonts and Vulkan drivers must be installed, and `DISPLAY` must refer to a running display. The browser unit suite in this environment also used SwiftShader flags on its pinned headless shell; default repository browser launch arguments do not guarantee a software adapter. Exact versions and source commits are in `provenance.json`.

## Related reports and remaining scope

- #311373: repaired the large-scroll coordinate mismatch and verified line 50,000. The reporter's RX 9070 XT environment was not tested.
- #249464 / #237583: excessive instances, stale fallback cache and edit invalidation are relevant; the tests do not certify every reported stale-text scenario.
- #277812: fractional sizing is repaired; the reporter's native Windows environment was not tested.
- #279526 / #238404: wrapped indentation already works on current main; both strategies have regression coverage.
- #301005 / #227120: ligature shaping remains a separate feature.
- #303488: terminal context loss is a separate renderer issue.
- #221145: feature tracker remains open; this work addresses the defects listed above.

## Build provenance and integrity

The macOS builds run on a separate fork branch and check out the exact source commit, independently of the workflow commit. They install native modules, run the targeted Electron tests, package Code OSS, apply and verify ad hoc signatures, verify the packaged CLI reports the source commit, and record SHA-256 archive checksums. The fork workflow applies a documented packaging-only workaround: its extension dependency filter retains the source-built Copilot SDK, which the app-root ignore list otherwise removes before SDK shim preparation. The original packaging failure and the exact tooling patch are retained. Editor/client sources are unchanged by this workaround. The build is not Apple notarized. The runner environment does not establish rendering on the contributor's Mac; manual testing is pending.

### Packaged Apple Silicon workbench

The packaged application passed a native Apple WebGPU check at the top and around line 50,000. Source, archive checksum and ad hoc signature were verified before launching it in an isolated profile. The final check requires an Apple adapter, enabled WebGPU, empty DOM text fallback, no captured GPU/page errors and over 1,000 dark pixels in an upper content region that excludes the gutter and bottom notification. The retained captures contain 11,642 / 13,421 content pixels. See `macos-workbench/arm64` and workflow run 38026650826. The earlier ARM captures are retained in `arm64-initial`; their broader ink region included notification pixels, so only the final bounded region is used for the quantitative visibility claim.

The final source build passed 53 targeted Electron tests on ARM64, including the actual WebGPU pixel test (two existing pending allocator cases). The Intel package also built and passed 52 tests, but its GPU pixel test skipped (three pending total). The Intel CI runner reports unavailable software WebGPU and no adapter. Its GPU-on workbench check failed and is retained under `x64-unavailable`; it is not counted as a rendering pass. The contributor selected Apple Silicon, which is the published test build.

### Contributor memory observation

The contributor tested the published app on an M1 Max with 64GB RAM and a 32-core GPU, and reports glyphs and scrolling working so far. Process Explorer screenshots show window memory about 655 MiB with GPU off and 1,180 MiB on (~80% higher); the GPU process reads 131 MiB in both. Summing the displayed app rows gives 1,705 versus 2,164 MiB (~27% higher), but this sum is not unique physical memory. Process Explorer derives memory from rounded `ps` percent-memory values; with 64GB RAM each 0.1 percentage point represents about 65.5 MiB. These observations do not settle total-memory acceptance. Raw contributor screenshots and paths are not published. See `contributor-observations.json` and `MEMORY-MACOS.txt` for the report and diagnosis procedure.

CPU glyph warmup remains in this patch. It rasterizes printable characters across token colors and subpixel variants, making it a profiling candidate. The full-file strategy reserves two CPU cell buffers and one GPU buffer totaling 43,200,000 bytes (~41.2 MiB) per renderer. Neither figure establishes the cause of the contributor's approximate 525 MiB window delta.

The evidence was checked for credentials, private keys, email addresses and private settings. No such content was found in the retained captures or logs. Local checkout paths and long browser debugging URLs were sanitized; assertions and results are retained. `SHA256SUMS.txt` records the published artifact hashes.

### Native Apple memory comparison

A diagnostic run (38027061717, workflow `620962cd`) uses the same packaged source, fresh off/on profiles, 1,800 generated JSON settings, Menlo 14 / Quiet Light and native Chromium scale 2. Each mode waits 60 seconds, records five alternating scrolls and then collects garbage. GPU-on has a 1400×1128 editor canvas and empty DOM text; GPU-off has no editor GPU canvas and nonempty DOM text. The actual app metrics, precise `ps` RSS, V8 heap/backing storage and screenshot captures are retained under `macos-memory/arm64`; derived rows are in `macos-memory/summary.json`.

| Phase | Renderer off / on (MiB) | GPU off / on (MiB) | JS used off / on (MiB) | V8 backing storage off / on (MiB) |
| --- | --- | --- | --- | --- |
| idle60s | 631.0 / 1050.2 | 82.6 / 146.4 | 70.2 / 80.1 | 43.6 / 72.4 |
| after5Scrolls | 632.0 / 1009.7 | 87.1 / 179.7 | 72.8 / 83.7 | 41.3 / 73.6 |
| afterExplicitGC | 624.8 / 1002.8 | 86.5 / 175.7 | 71.3 / 81.0 | 41.3 / 68.7 |

This reproduces a substantial renderer increase without a similarly large JS-heap increase. Much of the difference remains after explicit GC, making native backing stores, driver/allocator caches and staging storage profiling candidates. Renderer RSS declines during the limited scrolling sequence; this is not a general leak test. GPU helper RSS grows during scrolling. The single run does not establish physical/unified-memory acceptance or performance. Off/on order, the virtualized Apple runner and its workload differ from the contributor's Mac. The first collector attempt failed because a removed Electron WebContents API was called; its error is retained under `automation-attempt1`. The corrected collector uses `app.getAppMetrics`, `ps` RSS and CDP heap metrics.

## Copilot review follow-up

The original artifacts above remain tied to `bdc89a4a`. [copilot-review-fix](copilot-review-fix/README.md) records the review follow-up at source `228e79ffc4715b96a7475f63cd34d57939c07864`: four new regression failures on the previous code, 56 passing GPU tests, 18 native-scale editor captures, four live pixel-ratio uniform checks, lint and source hashes. macOS archives and memory measurements have not been regenerated for this follow-up.
