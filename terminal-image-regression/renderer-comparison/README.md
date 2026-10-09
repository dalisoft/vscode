# Terminal image rendering comparison

Focused browser evidence for the xterm image/transparency change. All captures use the repository-pinned xterm 6.1.0-beta.304, WebGL addon 0.20.0-beta.300, Image addon 0.10.0-beta.301, Playwright 1.64.0-alpha-1790635538000, and Chrome for Testing 156.0.8078.4. Rendering ran on Linux with software WebGL, not native macOS.

`dpr1/screenshots/` contains 30 complete captures (Quiet Light `#F5F5F5`, Monokai `#272822`; DPR 1): baseline text with and without ImageAddon; kitty, negative-z kitty, iTerm, and SIXEL image paths; both allowTransparency states; and opaque → translucent → opaque theme transitions. `dpr1/observations.json` records WebGL/addon/image status and terminal dimensions. `metrics.json` records screenshot pixel comparisons.

With an opaque theme, enabling ImageAddon without sending an image is pixel-identical to the no-addon text baseline: 151,300/151,300 pixels match on both themes at DPR 1, and 844,800/844,800 at DPR 2. The matrix includes regular, dim, bold, italic, and colored ANSI text. Reproducing the former unconditional transparency setting changes 8,877 light-theme pixels and 8,986 dark-theme pixels at DPR 1. Switching opaque → translucent → opaque returns to an image identical to the original opaque capture for both themes.

Kitty and iTerm use an actual RGBA PNG with opaque, partial-alpha, and a cleared zero-alpha hole. On Quiet Light, the transparent hole center is `(245,245,245)`, exactly the terminal background; the iTerm 16×16 hole matches the no-image baseline in all 256 pixels, and the Kitty hole interior matches in all 144 pixels. Opaque red and partial-alpha green samples also render. SIXEL uses the upstream add-on fixture and is decoded by ImageAddon.

`dpr2/text/` contains full DPR 2 text-only comparisons with and without ImageAddon. `dpr2/image-protocols-notext/` contains DPR 2 Kitty, iTerm, and SIXEL captures for both themes without text, plus corresponding observations. These establish DPR 2 protocol image decode/render paths independently of the DPR 2 text comparison.

These are focused renderer captures, not a native macOS/subpixel-font reproduction. The DPR 1 image protocol matrix is the combined text-plus-image evidence; DPR 2 image screenshots intentionally omit text.
