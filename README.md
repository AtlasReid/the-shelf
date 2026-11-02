# The shelf

An interactive collection of 14 scanned greeting cards by Kai Atlas Reid. Pick up a card, turn it over and open it to read the inside. The scene includes time-of-day lighting, wind-blown leaves, graphics settings and offline support.

[Open The shelf](https://atlasreid.github.io/the-shelf/) · **Version 1.0.0**

## Built with

Plain HTML, CSS and JavaScript modules, with locally bundled Three.js r185. The cards use procedural paper geometry and WebP scan textures. There is no framework, build step, CDN or application backend. Graphics preferences use browser-local storage without cookies.

The 3D view needs a browser with WebGL. Open **Settings → General → Compatibility mode** for the CSS version at `compatibility/`. Offline readiness applies to the main 3D app after all required assets have been cached.

## Run locally

Use Node.js 20 or newer. No dependency installation is required.

```sh
node server.mjs
```

Open [http://127.0.0.1:4318/](http://127.0.0.1:4318/). Use the HTTP server rather than opening the HTML file directly. `PORT` overrides the loopback-only server port; `npm start` is an equivalent shortcut.

To test a GitHub Pages project prefix, start the server with `BASE_PATH=/the-shelf/`. In PowerShell:

```powershell
$env:BASE_PATH = '/the-shelf/'
node server.mjs
```

Then open [http://127.0.0.1:4318/the-shelf/](http://127.0.0.1:4318/the-shelf/). Use a fresh terminal or remove the variable to return to the root URL.

## Checks

```sh
node checks/run-checks.mjs
```

`npm test` is equivalent. Checks cover scan assets, geometry, interaction, lighting, graphics quality, storage and offline behaviour. Automated checks do not replace visual review or physical-device testing.

## GitHub Pages

Publish the repository root through **Settings → Pages → Deploy from a branch → main → /(root)**. No build command or custom domain is required. Keep `.nojekyll` and relative asset URLs so deployment under a repository prefix works.

## Source map

| Files | Purpose |
| --- | --- |
| `index.html`, `scene.css`, `scene.js` | Page, scene, camera, card transitions and input |
| `card-mesh.js`, `paper-material.js`, `compatibility/cards.js` | Card geometry, materials, dimensions and texture catalogue |
| `solar-time.js`, `lighting.js`, `light-control.js` | Newcastle time, outdoor/indoor lighting and time controls |
| `adaptive-quality.js`, `render-diagnostics.js`, `reading-renderer.js` | Performance monitoring, graphics settings and reading detail |
| `preferences.js`, `settings-panel.js` | Validated browser preferences and settings interface |
| `leaves.js`, `ground-motion.js` | Leaf collisions and optional ground movement |
| `offline.js`, `offline-assets.js`, `sw.js`, `manifest.webmanifest` | Offline cache and PWA metadata |
| `compatibility/`, `vendor/three/`, `fonts/` | Card assets, compatibility page and bundled dependencies |

Prepared images are included; original scans are needed only to regenerate them. See [scripts/README.md](scripts/README.md) for the optional Python/Pillow preparation workflow.

## Continuing development

Start with [AGENTS.md](AGENTS.md) for implementation constraints and continuation notes. The repository is self-contained; the original chat and private source archives are not needed for ordinary development.

- Inspect the working tree and preserve unrelated changes.
- Keep card proportions, pickup guards, mouse/touch controls, reduced motion and on-demand rendering intact.
- Run the relevant checks after changes. Update `OFFLINE_VERSION` and the explicit asset list in `offline-assets.js` when runtime assets change.
- Keep source scans, local preview state and credentials out of commits. Publish only the requested changes.

## Assets and licensing

Three.js retains its MIT licence; DM Sans and Manrope retain their SIL Open Font Licences. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No open-source licence has been declared for the application code or card artwork/scans.
