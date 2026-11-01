# 3D Generation (`chatroom generate-3d`)

**Status:** Implemented
**Last Updated:** 2026-10-29

---

## What it does

`chatroom generate-3d` turns a prompt or a reference image into one 3D mesh: a
GLB with its texture baked in, a `.zip` bundle beside it, and a standalone
preview page. The written materials are normalised, and the asset can optionally
be fitted to a target height and origin. Set `FAL_API_KEY` first; the command
calls fal directly and needs no chatroom authentication. Prices below are
list-price estimates, not billed amounts.

## Quick start

Trellis from a prompt (a reference image is generated first):

```bash
chatroom generate-3d --prompt "a wooden treasure chest" --out chest.glb
```

Trellis from an image:

```bash
chatroom generate-3d --input-image ./concept.png --out chest.glb
```

Meshy rig with a clip (confirm the priced dry run first):

```bash
chatroom generate-3d --model meshy/v7.1/image-to-3d --input-image ./concept.png --out knight.glb --rig --animation-action-id 0 --dry-run
```

## Models

| Model id                                  | Input                   | List price             | Rigging | Notes                                                     |
| ----------------------------------------- | ----------------------- | ---------------------- | ------- | --------------------------------------------------------- |
| `fal-ai/trellis-2`                        | image (`--input-image`) | $0.30 at 1024          | no      | the default; a prompt adds $0.005 for the reference image |
| `meshy/v7.1/text-to-3d`                   | prompt                  | $0.80 + $0.40 textures | yes     |                                                           |
| `meshy/v7.1/image-to-3d`                  | image                   | $0.80 + $0.40 textures | yes     |                                                           |
| `fal-ai/hunyuan-3d/v3.1/rapid/text-to-3d` | prompt                  | $0.225                 | no      |                                                           |

Any other id runs without a check or a price.

## Rigging and animation

Bones and animation come from Meshy 7.1 only: `--model meshy/v7.1/text-to-3d` or
`meshy/v7.1/image-to-3d`, plus `--rig` and optional `--animation-action-id`
(Meshy presets 0–696). A real run needs `--confirm-cost`, after you have
confirmed the priced `--dry-run`; rigging is billed on top of the mesh ($0.20
plus $0.12 per clip). Rigging is verified only for Meshy GLBs and expects a
humanoid mesh; non-humanoid meshes fail on fal. Every other model refuses the
rig flags before any paid call:

```text
fal-ai/trellis-2 cannot rig. Bones and animation come from Meshy 7.1 only.
Omit: --rig
Corrected command:
  chatroom generate-3d --platform=fal --model meshy/v7.1/text-to-3d --prompt 'a chest' --rig --out chest.glb
Review the estimate, then re-run with --confirm-cost.
```

## Outputs

Every run writes `<base>.zip` next to `--out` (or in `--package-dir`), where
`<base>` is `<out-stem>-<timestamp>`:

- `<stem>.glb` — the master, with materials normalised (and fitted when the fit
  flags are used). Its `sha256` is the hash of the written bytes; the package
  manifest also records `sourceSha256`, the hash of the bytes fal returned.
- `web/<stem>.web.glb` — the browser-sized web variant. It reuses the master's
  material decisions and fit, then reduces textures and simplifies geometry.
- `<stem>.rigged.glb` and `web/<stem>.rigged.web.glb`, plus
  `<stem>.anim-<id>.glb` and `web/<stem>.anim-<id>.web.glb` per clip — each
  written rig file is normalised, and all rig files share the fit computed from
  the rigged GLB; every entry records that fit.
- `manifest.json` — the package record: files, sizes, triangle counts, request
  ids, material decisions, fit results (including the wrapper translation), and
  asset checks.
- `reference/<name>` — the reference image with its original extension, when one
  was generated or supplied; a generated image also sits beside `--out` as
  `<stem>-reference.png`.
- `<base>.html` — a standalone preview with both variants, Studio/Directional/
  Unlit lighting, and a Checks panel.

The sidecar `<out>.json` records the generation itself (request, source hash,
written hash, package link, and any rigging).

## Materials

Every written GLB gets the same material normalisation (`material-normalise.ts`):

- A material with a metallic-roughness texture whose metal share is below
  `NON_METAL_FRACTION_MAX` (0.01, meaning fewer than 1% of texels have metal
  ≥ 0.5) gets `metallicFactor` 0. The texture is kept, so roughness is
  unaffected.
- An untextured material whose `metallicFactor` is 1 becomes 0; a constant metal
  with no texture is almost always a model default.
- A material with an explicit `metallicFactor` other than 1 is left alone,
  textured or untextured. The normaliser only fills in the default factor.
- A real metal material keeps `metallicFactor` 1, and its blue channel is
  masked: blue values below `METAL_MASK_THRESHOLD` (128) become 0, then the map
  is saved as lossless PNG. Green (roughness) is never changed.
- `maskedFraction` is the share of **all** texels whose original blue value was
  between 26 and 127 inclusive. Values from 0 to 25 are also zeroed, but they
  were already non-metal, so they are not counted as masked.
- A metallic-roughness texture used by more than one material, or by a slot of
  another material, gets one shared masked copy when a user remains on the
  original; otherwise the original is masked in place. Unused textures are
  pruned before the master is written.

The decisions are recorded in the manifest. The master, web variant, and every
rig output use the same rules.

## Fit flags

Both flags are optional and apply to the master, the web variant, and every rig
output:

- `--target-height <m>` scales the model uniformly so its height is that many
  metres. A zero-height scene is refused.
- `--origin feet|center|as-is` moves the origin. `feet` puts the bottom centre at
  the origin, `center` puts the bounding-box centre there, and `as-is` is the
  default.

The fit is applied through one wrapper node above the scene roots, so existing
root transforms and animation channels are untouched. For rigging, the wrapper
scale and offset are computed once from the rigged GLB and applied to every
clip; each `rigging.files[]` entry records the same `FitResult`, including its
`translation`.

With no fit flags, output is unchanged from before this change except for the
material normalisation above. Example:

```bash
chatroom generate-3d --platform=fal --model fal-ai/trellis-2 --prompt "a wooden barrel" --out ./barrel.glb --target-height 0.75 --origin feet
```

## Preview lighting

The preview page has three lighting modes:

- **Studio** — the viewer's default lighting; the page has always used it.
- **Directional** — one sun on a black equirectangular environment, an
  approximation of a directional light. The environment is low-dynamic-range, so
  the sun needs a high viewer exposure to be visible.
- **Unlit** — base colour only, switched through model-viewer's runtime material
  API. It reuses the loaded base-colour texture and does not embed a second copy
  of the model.

These modes are for inspecting the asset. Studio is image-based lighting: it is
the best case, and it is **not evidence** that the asset renders in a game whose
scene has no environment map. Directional and Unlit approximate the no-environment
game case. An asset is not accepted until it has been rendered under the project's
real rig, or the user explicitly accepts it.

## Checks

The preview shows, and the manifest records, advisory checks computed from the
written asset. They are **warnings only** and never fail a run. The thresholds
live in `CHECK_THRESHOLDS` in `checks.ts`:

| Check id              | Rule                                                                                                                                                               | Message                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `metal-whole-texture` | Material factor > 0 and a texture with metal ≥ `wholeTextureMetalFraction` (0.5), or no texture and factor ≥ 0.5                                                   | `Material {index} looks metal across its whole surface; check that the surface really is metal.`                         |
| `flat`                | `min(extents) / max(extents) < flatRatio` (0.05)                                                                                                                   | `Model is flat (thickness is under 5% of its width); a flat model may disappear from some angles.`                       |
| `not-on-feet`         | `abs(bounds.min.y) > feetShare` (0.01) × height                                                                                                                    | `Model's base is not at the origin. Use --origin feet to move the base to the origin.`                                   |
| `glossy-non-metal`    | Textured: metal share < 0.01 and `roughnessFactor × roughness.mean < glossyRoughnessMean` (0.35). Untextured: `metallicFactor < 0.5` and `roughnessFactor < 0.35`. | `Material {index} is non-metal with low roughness (mean or factor {value}); it may look glossy or metallic under light.` |

The CLI prints each warning as `Warning: <message>` after the `Preview` line.
The preview page lists them in its Checks panel. `generate-3d preview` recomputes
them from the zip; it does not trust the stored manifest checks.

## Rebuild without generating

`chatroom generate-3d preview <package.zip> [--force]` rebuilds `<base>.html`
beside an existing package. It makes no network call and does not need
`FAL_API_KEY`. It recomputes the checks and regenerates the preview from the
GLBs in the zip. Existing `<base>.html` is replaced only with `--force`.

## Unknown models and `--input`

Any fal id is accepted. An unknown id has no capability check and no price, so
the plan prints `Generation cost unknown`. `--input '<json>'` (or `--input @file`)
merges model-specific fields into the fal request, for known and unknown models
alike; `prompt` and `image_url` are reserved for `--prompt` and `--input-image`.

## Flags

| Flag                          | Meaning                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `--model <id>`                | fal endpoint id; defaults to `fal-ai/trellis-2`, any id is accepted.         |
| `--out <path>`                | Output GLB path; the manifest is `<path>.json`.                              |
| `--prompt <text>`             | Text prompt; with the default model a reference image is generated first.    |
| `--input-image <path-or-url>` | Reference image: a local `.png`/`.jpg`/`.jpeg` (uploaded) or an http(s) URL. |
| `--input <json\|@file>`       | Extra fal request fields, merged over the model defaults.                    |
| `--rig`                       | Rig with Meshy 7.1; Meshy models only, and needs `--confirm-cost`.           |
| `--animation-action-id <id>`  | Meshy preset clip (0–696), repeatable; requires `--rig`.                     |
| `--target-height <m>`         | Scale the model so its height is this many metres.                           |
| `--origin <mode>`             | `feet`, `center`, or `as-is` (default).                                      |
| `--confirm-cost`              | Confirm the priced plan for a real rigging run; not needed with `--dry-run`. |
| `--package-dir <dir>`         | Directory for the zip and preview; defaults to the directory of `--out`.     |
| `--force`                     | Replace existing output, reference, package, preview, rig, and clip files.   |
| `--dry-run`                   | Print the request and the list-price estimate; no upload or fal call.        |
| `--platform <name>`           | Generation platform; only `fal`.                                             |

## Known limits

- The rigged and animated GLBs are normalised and fitted after download, but
  rigging itself still runs on the raw fal master.
- The directional preview is approximate: one low-dynamic-range sun, not a
  measured studio or engine environment.
- The web variant's triangle simplification is best effort and can overshoot its
  30,000 target for some meshes (the barrel measures 45,483). This is tracked
  separately and is not changed by the material or fit work.

## Troubleshooting

- Web textures are capped at 1024 px on the longest edge. Colour (sRGB) maps are
  JPEG q80 with 4:2:0 chroma; data maps (metallic-roughness, occlusion, normal)
  are JPEG q95 with 4:4:4; alpha-bound colour maps stay truecolour PNG. Formats
  outside JPEG/PNG/WebP, such as KTX2, are left unresized.
- Rigged and animated web variants keep their full geometry; only their textures
  are reduced.
- A local `--input-image` is uploaded to fal storage and its URL lasts one day.
  An http(s) URL is passed through and never downloaded.
- A rig failure keeps the paid master, its manifest, and the package, then exits
  with status 1. A failed rig web variant still ships the raw rig GLB and is
  listed in `riggingWebFailures`.
- The global `chatroom` install may predate this command; check with
  `chatroom generate-3d --help`.
