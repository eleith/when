---
'@when/web': patch
---

Serve the configured avatar through `/avatar/<configured-path>`, with `?thumbnail=true` providing a cached, automatically resized web avatar without a separate image or new configuration. The requested path is only validated against configuration; it never selects another source. Keep original images for share cards, preserve SVGs and animations, and use the original when resizing cannot reduce the download. Document Takumi's existing EXIF-orientation limitation.

Share concurrent source loading and resizing, and forward originals without mismatched compression headers.
