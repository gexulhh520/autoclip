# Subtitle fonts

AutoClip resolves subtitle overlay fonts in this order:

1. `AUTOCLIP_SUBTITLE_FONT_PATH` or `template_rules.quote_overlay.font_file`
2. Bundled files in this directory, such as `NotoSansCJKsc-Regular.otf`
3. Common system fonts on macOS, Windows, and Linux

For packaged/offline desktop builds, place a Chinese-capable OpenType/TrueType font here and name it
`NotoSansCJKsc-Regular.otf` (or set `font_file` in a template). Docker images install `fonts-noto-cjk`
so the Linux fallback path is available by default.
