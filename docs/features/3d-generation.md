# 3D Generation (`chatroom generate-3d`)

**Status:** Implemented
**Last Updated:** 2026-10-28

---

## What it does

`chatroom generate-3d` turns a prompt or a reference image into one 3D mesh: a
GLB with its texture baked in, a `.zip` bundle beside it, and a standalone
preview page. Set `FAL_API_KEY` first; the command calls fal directly and needs
no chatroom authentication. Prices below are list-price estimates, not billed
amounts.

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

## The bundle

Every run writes `<base>.zip` next to `--out` (or in `--package-dir`), where
`<base>` is `<out-stem>-<timestamp>`:

- `<stem>.glb` — the master, byte-for-byte what fal returned.
- `web/<stem>.web.glb` — the browser-sized web version.
- `manifest.json` — the package record: files, sizes, triangle counts, request ids.
- `reference/<name>` — the reference image with its original extension, when one
  was generated or supplied; a generated image also sits beside `--out` as
  `<stem>-reference.png`.
- `<stem>.rigged.glb` and `web/<stem>.rigged.web.glb` — when rigging ran.
- `<stem>.anim-<id>.glb` and `web/<stem>.anim-<id>.web.glb` — one pair per clip.

`<base>.html` beside the zip is a standalone preview of the web version.

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
| `--confirm-cost`              | Confirm the priced plan for a real rigging run; not needed with `--dry-run`. |
| `--package-dir <dir>`         | Directory for the zip and preview; defaults to the directory of `--out`.     |
| `--force`                     | Replace existing output, reference, package, preview, rig, and clip files.   |
| `--dry-run`                   | Print the request and the list-price estimate; no upload or fal call.        |
| `--platform <name>`           | Generation platform; only `fal`.                                             |

## Limits and troubleshooting

- The 30,000-triangle target for the web version is best effort; the manifest
  records what was achieved.
- Rigged and animated web versions keep full geometry; only their textures are
  reduced.
- A local `--input-image` is uploaded to fal storage and its URL lasts one day; a
  URL is passed through, never downloaded.
- A rig failure keeps the paid master, its manifest, and the package, and exits 1.
- The global `chatroom` install may predate this command; check with
  `chatroom generate-3d --help`.
