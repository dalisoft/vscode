# Terminal image support: regression evidence

AI-assisted fix contributed by @dalisoft. Implementation, investigation, and validation were generated with OpenAI Codex under the contributor's direction.

Fixes microsoft/vscode#338199 and microsoft/vscode#299442. This evidence branch is separate from the source-change PR branch. The source change touches three files; these images and logs are retained here so the PR remains reviewable after local cleanup.

See `provenance.json` for exact source commits, environment, and validation boundaries. The logs show 36 Chromium tests, 37 Electron tests, a successful client build and targeted lint. `unit-original.log` records nine failures when the original production implementation was compiled with the new regression tests. The fixed compiled implementation was restored and the full Chromium suite was rerun successfully.

`terminal-image-regression/light-before.png` reproduces the former unconditional transparency path on Quiet Light. `light-after.png` uses the fixed opaque-background path, with image support enabled. These are focused renderer captures, not a complete VS Code workbench or native macOS capture.

`terminal-image-regression/renderer-comparison/README.md` describes the real WebGL/ImageAddon matrix. Its `metrics.json` contains exact pixel comparisons; observations and all final screenshot captures are retained alongside it. The screenshots show regular, dim, bold, italic, and ANSI-colored text plus Kitty/iTerm/SIXEL image paths, including real partial-alpha and zero-alpha PNG regions.

`manifest.sha256` records the SHA-256 of each proof file.

The published Electron log replaces its absolute local workspace path with `/workspace/vscode`. Test output and results are unchanged. The evidence was checked for credentials, private keys, email addresses, and private settings; none were found.
