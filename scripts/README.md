# Project scripts

## Preparing the scanned cards

`prepare-card-scans.py` is a local preparation step, not a website feature or runtime dependency. It requires Python and Pillow. Supply the `Paired cards` source directory explicitly, or use the default location two directories above this checkout:

```sh
python scripts/prepare-card-scans.py "../../Paired cards"
```

The script reads the 14 cards listed in its catalogue. It leaves every original scan unchanged and exports 54 detailed WebP surfaces to `compatibility/assets/scans/` plus 54 small copies in `previews/`, the shared `compatibility/cards.js` catalogue, and a machine-readable preparation manifest. No original full-resolution scan is copied into the website.

Source folders `Card_01`–`Card_14` match the project numbers directly. Penguin pair is 13 and Polar bears is 14; there is no source-number remapping or importer exception. Generated IDs, labels, reading/preview filenames and manifest entries use the same continuous numbering.

The millimetres in each source filename describe the complete flat scan. Folded-card widths are therefore half the outside spread width; card 14 instead folds across its horizontal centre, so its closed height is half the outside spread height. Card 07 uses its complete dimensions as a single-sheet postcard. Outside dimensions provide the common geometry for each paired scan; tiny differences in inside measurements from cropping/rounding are normalised to that same proportion.

For the ordinary side-fold cards, outside-left is the back, outside-right is the front, and the two inside halves remain left and right. For the top-fold card 14, the lower outside half is the front and the upper outside half is rotated 180° for the upright back. The upper inside half is rotated 180° for the raised upper leaf; the lower inside half stays upright. Its catalogue keys `insideLeft` and `insideRight` mean upper and lower respectively. Card 07's second scan is its reverse, with no splitting.

Detailed surfaces use sRGB, WebP quality 90 and a maximum 1,800-pixel long edge. Collection previews use quality 85 and a 512-pixel long edge to limit decoded texture memory; the selected card loads detailed surfaces for reading. Colour profiles are converted to sRGB before resizing, and scanner EXIF metadata is omitted from the derivatives. Filenames retain the closed card's physical dimensions in millimetres. These are browser derivatives; preserve the paired source directory separately for future export changes.

Card 04's `finish: 'metallic-outside'` is a material hint. The scan files do not contain invented highlights or metallic pixels; the 3D app adds the light response separately, and a flat scan cannot recover the original material's reflectance exactly.

Card 03 uses `finish: 'gold-foil'` with a small, UV-aligned front material map in `finishMaps`. Only its warm gold sun is selected, inside a broad region that excludes scanner-edge colour casts. The blue channel supplies metalness and the green channel supplies roughness in linear colour space; white paper and navy printing remain matte. Its RGB scan images are unchanged. The map's 1024-pixel long edge preserves a soft boundary while adding under 10 KB.

Card 14 uses `finish: 'gold-metallic-ink'` and a 1024-pixel `insideRight` material map for the handwritten “Merry Christmas & Happy 2024!” greeting. Warm-colour selection follows the actual gold strokes within the greeting region, excluding the white paper, black salutation/signature and scanner edges. Its higher roughness and lower metalness produce a softer response than card 03's foil. The other inside and both exterior surfaces remain matte. The map is about 44 KB; the RGB scans are unchanged, and the same material coordinates apply in preview and reading detail.

To rebuild both selective material maps and their catalogue/manifest entries, leaving the 108 existing scan derivatives byte-identical:

```sh
python scripts/prepare-card-scans.py "../../Paired cards" --finish-only
```

## Private phone testing with Tailscale

This runs the current working files on your computer, independently of the GitHub Pages release. Connect the computer and phone to the same Tailscale network. In an Administrator PowerShell, from this repository, run:

```powershell
& './scripts/start-private-preview.ps1'
```

The helper prints the private HTTPS address, in the form `https://<your-device>.<your-tailnet>.ts.net:8443/the-shelf/`. Open it in Safari on the phone. Keep the computer awake and Tailscale connected. You can use Safari's Add to Home Screen for PWA testing. The private HTTPS origin has its own settings and offline cache, separate from both localhost and GitHub Pages.

The helper starts a hidden Node server on `127.0.0.1:4318`, with `BASE_PATH=/the-shelf/` and `RUNTIME_ONLY=1`, then configures **Tailscale Serve**, not public Funnel. It preserves existing Serve routes on other ports, including port 443. It refuses to replace a conflicting service or reuse an HTTPS port with Funnel enabled. Both local/HTTPS ports can be set with `-Port` and `-HttpsPort`. If an ordinary development server already occupies the local port, stop that server first or choose a different `-Port`; the helper does not kill unrelated processes.

Private-preview mode is an exact allowlist: main-app offline assets plus the three CSS compatibility entry files. Repository documentation, tests, preparation scripts/metadata, `.git`, logs and raw source scans are not shared. The Node server remains loopback-only. The preview requires no GitHub push, custom domain, router forwarding or public tunnel. Runtime assets are still necessarily readable by devices allowed to access the preview.

To stop this preview and its owned Node process:

```powershell
& './scripts/stop-private-preview.ps1'
```

Use `-KeepServer` to remove only the private HTTPS route. Stop/start when adding runtime modules so the server reloads its allowlist; edits to existing files are served on browser reload. After reboot, rerun the start helper. `.preview/` contains ignored local PID/URL state, logs and a pre-change Serve snapshot; it must not be committed. Tailnet access rules still govern which devices can connect. See [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) for the network model.
