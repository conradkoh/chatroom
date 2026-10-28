# 3D Generation (`chatroom generate-3d`)

**Status:** Implemented
**Last Updated:** 2026-10-27

---

`chatroom generate-3d` generates one 3D mesh with a fal model and writes the mesh
as a GLB at `--out`, plus a JSON sidecar manifest at `<out>.json`. It then
packages the run as two sibling files: `<base>.zip` (the master, a smaller web
variant, and a package manifest) and `<base>.html` (a standalone preview of the
web variant). With `--rig` it also rigs the mesh with Meshy and writes
`<stem>.rigged.glb`, plus one `<stem>.anim-<id>.glb` per requested animation clip.

`--model` is required; there is no default and no free-form passthrough. Only
the model ids in [Choose the model](#choose-the-model) are accepted. Run a
command with `--dry-run` first to see the exact request, the planned output
paths, and the estimated cost of the run.

The command talks to fal directly and does not require chatroom authentication.

## Prerequisites

- A fal account.
- A fal API key created in the fal dashboard.

## Setup

### 1. Store the API key

The command reads the key from the `FAL_API_KEY` environment variable. It does
not read `FAL_KEY`, and it does not support `FAL_KEY_ID`/`FAL_KEY_SECRET`.

Add the export to your shell profile with an editor so the key never appears in
your shell history or on screen:

```bash
# zsh (macOS default)
$EDITOR ~/.zshrc

# bash
$EDITOR ~/.bashrc
# macOS login shells may read ~/.bash_profile instead
```

Add this line, replacing the placeholder with the key from the fal dashboard:

```bash
export FAL_API_KEY="<paste-your-key-here>"
```

Save the file, then start a new terminal or load the profile:

```bash
source ~/.zshrc   # or: source ~/.bashrc
```

Confirm the variable is set without printing its value:

```bash
[ -n "$FAL_API_KEY" ] && echo "FAL_API_KEY is set"
```

`--dry-run` never reads the key, so you can check a request before setting it.

### 2. Install or update the CLI

```bash
npm install -g chatroom-cli@latest
```

If the CLI is already installed, update it in place:

```bash
chatroom update
```

`generate-3d` requires chatroom-cli 1.137.4 or later. Confirm the command is
available:

```bash
chatroom generate-3d --help
```

## Usage

### Generate a mesh

```bash
chatroom generate-3d \
  --platform=fal \
  --model meshy/v7.1/text-to-3d \
  --prompt "a weathered stone knight statue, full body, arms at the sides" \
  --out assets/models/stone-knight.glb
```

The command writes the files, then prints their paths and a static list-price
estimate:

```text
Generated /path/to/your/project/assets/models/stone-knight.glb
Manifest /path/to/your/project/assets/models/stone-knight.glb.json
Package /path/to/your/project/assets/models/stone-knight-20261028-011838.zip
Preview /path/to/your/project/assets/models/stone-knight-20261028-011838.html
Cost estimate (prices as of 2026-10-27; estimate; fal returns no billed cost):
- base $0.80
- textures +$0.40
Estimated total: $1.20
```

Parent directories are created automatically.

`--out` must end with `.glb`; the command refuses any other extension before
making the paid fal call, because it always writes a GLB.

Failures are reported on stderr with a leading `❌` and a non-zero exit code. A
download or save failure still names the fal request id and the GLB URL so a paid
result can be recovered.

### Check a request first (`--dry-run`)

`--dry-run` runs every check the real command runs, then prints the model, the
output, package, and preview paths, the exact request JSON, the rigging request
and clip paths when `--rig` is set, and a `Cost estimate` block. It makes no upload and no fal
generation call, and it needs no `FAL_API_KEY`.

```bash
chatroom generate-3d \
  --platform=fal \
  --model meshy/v7.1/text-to-3d \
  --prompt "a weathered stone knight statue" \
  --out assets/models/stone-knight.glb \
  --rig \
  --animation-action-id 0 \
  --dry-run
```

```text
Would generate /path/to/your/project/assets/models/stone-knight.glb
Manifest /path/to/your/project/assets/models/stone-knight.glb.json
Package /path/to/your/project/assets/models/stone-knight-20261028-011838.zip
Preview /path/to/your/project/assets/models/stone-knight-20261028-011838.html
Model meshy/v7.1/text-to-3d (text-to-3D, licence: commercial)
Request:
{
  "prompt": "a weathered stone knight statue"
}
Rigging request (fal-ai/meshy/rigging/multi-animation):
{
  "model_url": "<generated mesh GLB URL>",
  "animation_action_ids": [
    0
  ]
}
Rigged GLB /path/to/your/project/assets/models/stone-knight.rigged.glb
Animation clip 0 /path/to/your/project/assets/models/stone-knight.anim-0.glb
Rigging (Meshy) expects a humanoid mesh; non-humanoid meshes fail on fal.
Cost estimate (prices as of 2026-10-27; estimate; fal returns no billed cost):
- base $0.80
- textures +$0.40
- rigging (Meshy) $0.20
- animation clips (1) $0.12 each = $0.12
Estimated total: $1.52
No upload or fal generation call was made.
```

The cost block is a static list-price estimate, never the billed amount: fal
returns no billed cost and the command has no live price lookup. Check the fal
dashboard for the actual bill. The block names the price date, lists one line per
charge, and ends with `Estimated total`. A charge that was not requested, such
as Hunyuan's optional PBR maps, appears with `excluded from the total`.

`--dry-run` also refuses an existing output path, an existing package zip or
preview, an unknown model id, a missing or mismatched input flag, an invalid
animation clip id, and a rigging output that already exists — the same checks the
real run performs. A package name that needs `{requestId8}` is validated here but
its final paths can only be shown after the call.

### Choose the model

Pass the model id with `--model`; the command fails without it
(`error: required option '--model <id>' not specified`). The allowlist is
closed: an id that is not in this table is refused before any upload or fal call.

| Model id                                  | Task            | fal endpoint                              | Output                          | List price (2026-10-27) |
| ----------------------------------------- | --------------- | ----------------------------------------- | ------------------------------- | ----------------------- |
| `meshy/v7.1/text-to-3d`                   | `--prompt`      | `meshy/v7.1/text-to-3d`                   | GLB + separate texture files    | $1.20                   |
| `fal-ai/hunyuan-3d/v3.1/rapid/text-to-3d` | `--prompt`      | `fal-ai/hunyuan-3d/v3.1/rapid/text-to-3d` | GLB; texture URL when returned  | $0.225                  |
| `meshy/v7.1/image-to-3d`                  | `--input-image` | `meshy/v7.1/image-to-3d`                  | GLB + separate texture files    | $1.20                   |
| `fal-ai/trellis-2`                        | `--input-image` | `fal-ai/trellis-2`                        | GLB only; textures are embedded | $0.30                   |

Prices are fal list prices read from the public model pages on 2026-10-27. They
are not a billed amount. The per-model breakdown is:

- **Meshy v7.1** — $0.80 base plus $0.40 for textures. The command sends the
  endpoint's default `full` mode, so the request is textured and both lines are
  part of the total.
- **Hunyuan 3D v3.1 rapid** — $0.225 base. Optional PBR maps add $0.15, but the
  command does not request them, so they are excluded from the total.
- **Trellis-2** — $0.30 at the `1024` resolution the command sends explicitly.
  The endpoint also offers 512 ($0.25) and 1536 ($0.35); the command does not
  expose the resolution.
- **Rigging** — see [Rigging and animation clips](#rigging-and-animation-clips).

Every model records the same `licenseType` value of `commercial`, copied
verbatim from the fal catalog. That is the catalog's label, not a legal
interpretation: check fal's terms and the model page before using an asset in
production.

### Overwrite an existing file

`--out` and `<out>.json` must not already exist. Pass `--force` to replace them.
With `--rig`, the rigged GLB and every clip GLB are checked the same way:

```bash
chatroom generate-3d \
  --platform=fal \
  --model meshy/v7.1/text-to-3d \
  --prompt "a weathered stone knight statue" \
  --out assets/models/stone-knight.glb \
  --force
```

Without `--force`, the command refuses before making the paid fal call.

### Other options

| Option                        | Meaning                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--platform <name>`           | Generation platform. Only `fal` is supported (default).                                                                    |
| `--prompt <text>`             | Text prompt for a text-to-3D model. Required for, and only accepted by, a `text-to-3D` model.                              |
| `--input-image <path-or-url>` | Reference image for an image-to-3D model. Required for, and only accepted by, an `image-to-3D` model.                      |
| `--rig`                       | Rig the generated mesh with Meshy (`fal-ai/meshy/rigging`). Humanoid meshes only.                                          |
| `--animation-action-id <id>`  | Meshy preset animation id from 0 to 696, repeatable; switches to `fal-ai/meshy/rigging/multi-animation`. Requires `--rig`. |
| `--name <template>`           | Package base name: `{stem}`, `{model}`, `{timestamp}`, `{requestId8}`; default `{stem}-{timestamp}`.                       |
| `--package-dir <dir>`         | Directory for the package zip and preview (default: the directory of `--out`).                                             |
| `--force`                     | Replace existing output, manifest, package, preview, rigged, and clip files.                                               |
| `--dry-run`                   | Validate, print the request and the static list-price estimate; no upload or fal generation call.                          |

## Generating from a reference image

Pass `--input-image` to an image-to-3D model instead of `--prompt`:

```bash
chatroom generate-3d \
  --platform=fal \
  --model meshy/v7.1/image-to-3d \
  --input-image ./concept/knight-front.png \
  --out assets/models/stone-knight.glb
```

`--input-image` accepts two forms:

- A local file with a `.png`, `.jpg`, or `.jpeg` extension. The file is uploaded
  to fal storage with a one-day lifetime, and only the returned URL is sent to
  the model. Any other extension — including `.webp` and `.gif` — is rejected
  before the upload; the allowlist follows the formats Meshy's image-to-3D
  endpoint accepts.
- A public `http(s)` URL. It is passed to fal unchanged, so it must be reachable
  without authentication for the duration of the call.

Passing both `--prompt` and `--input-image` is an error, as is passing the flag a
model does not take: a text-to-3D model rejects `--input-image`, and an
image-to-3D model rejects `--prompt`.

The manifest records the input in `inputImage`: `source` is the local absolute
path or the URL exactly as given, and `url` is the value sent to fal. For
text-to-3D, `inputImage` is `null`. An uploaded file's URL expires after one day,
so the recorded `inputImage.url` and `input.image_url` stop working after that.
Do not pass presigned or credential-bearing URLs for assets that will be
committed.

The reference image is the only input an image-to-3D model takes, so the whole
frame becomes the subject. Meshy v7.1 accepts a reference image as well as a
prompt; Trellis-2 accepts a reference image only.

## Rigging and animation clips

`--rig` runs a second paid call after the mesh is written:

| Step               | Endpoint                               | List price (2026-10-27) |
| ------------------ | -------------------------------------- | ----------------------- |
| Rig only (`--rig`) | `fal-ai/meshy/rigging`                 | $0.20                   |
| Rig plus clips     | `fal-ai/meshy/rigging/multi-animation` | $0.20 + $0.12 per clip  |

The rigging call sends the public URL of the GLB fal just returned, so the mesh
is not uploaded again. The request body is exactly `{ model_url }` for `--rig`,
and `{ model_url, animation_action_ids }` when at least one
`--animation-action-id` is given. No other parameter is sent.

```bash
chatroom generate-3d \
  --platform=fal \
  --model meshy/v7.1/text-to-3d \
  --prompt "a stone knight statue, humanoid, standing" \
  --out assets/models/stone-knight.glb \
  --rig \
  --animation-action-id 0 \
  --animation-action-id 12
```

`--animation-action-id` is repeatable. Each value must be an integer from 0 to
696; ids are kept in the order given and a duplicate is refused. An invalid id,
a duplicate id, or the flag without `--rig` fails before any paid call.
Meshy publishes no name map for the presets, so the command takes numeric ids
only.

**Rigging is humanoid-only.** Meshy expects a humanoid character; a
non-humanoid mesh (a prop, a vehicle, a quadruped) fails on fal. The rig failure
keeps the already-written mesh and its manifest, so the paid generation is never
discarded — see [Failure semantics](#failure-semantics).

### Output files

Each step writes its own file: the mesh, sidecar, rig, and clips beside `--out`, the package zip and preview in `--package-dir`.

| Step                | File                                     |
| ------------------- | ---------------------------------------- |
| Mesh                | `<out>` (for example `stone-knight.glb`) |
| Manifest            | `<out>.json`                             |
| Package             | `<packageDir>/<base>.zip`                |
| Preview             | `<packageDir>/<base>.html`               |
| Rig                 | `<stem>.rigged.glb`                      |
| Each animation clip | `<stem>.anim-<id>.glb`                   |

`<stem>` is `--out` without its `.glb` suffix. Only GLBs are downloaded. The
rigging response also carries an FBX variant of the rigged character and the
basic walking/running animation variants; those are recorded in the manifest by
URL only and never written to disk. The manifest records the rigged file in
`rigging.riggedGlbPath`, which matches `<stem>.rigged.glb`.

### Failure semantics

A run writes in this order: the master GLB, its sidecar manifest, the package
(zip, then preview), and finally the rig files. Everything after the master is
optional in the sense that its failure never discards a paid generation, but the
stage that failed decides what you have on disk.

**Packaging fails.** The master and its sidecar are already saved, so they stay.
The error names the request id and the GLB URL, so the mesh can be recovered
without paying for another generation. Within packaging:

- a failed zip write removes the partial zip;
- a failed preview write removes the zip written moments earlier, so a package
  directory never holds a zip without its preview;
- a package-name collision (`Package already exists` / `Preview already exists`)
  is checked before either file is written. For a name that needs
  `{requestId8}`, that check can only happen after the paid call — the master and
  sidecar are kept and only the package is refused.

**Rigging fails.** Packaging runs _before_ rigging, because the package is a pure
function of the master. A rig failure therefore leaves the master, the sidecar,
the zip, and the preview in place; only the rigged GLB and the clips are missing.
The sidecar records no `rigging` section, and the error names the rigging
endpoint, the rigging request id when fal returned one, and the kept mesh. Any
rigged or clip file already downloaded stays, because each is written as soon as
its download succeeds.

**Re-running.** The same command needs `--force`, because the master and sidecar
already exist. With `--force` and a fixed `--name`, the previous zip and preview
are removed before the new pair is written, so the directory never holds a stale
package beside a new master. Re-running just the rig is not a separate command;
the mesh is regenerated and billed again.

## The package

Every successful run writes two files that share a base name, so they sort next to
each other:

| File          | Contents                                            |
| ------------- | --------------------------------------------------- |
| `<base>.zip`  | `<stem>.glb`, `web/<stem>.web.glb`, `manifest.json` |
| `<base>.html` | A standalone preview page of `web/<stem>.web.glb`   |

`<base>` comes from `--name`; the directory comes from `--package-dir` (default:
the directory of `--out`). The zip entry names use `<stem>`, not `<base>`, so the
master keeps a stable name inside the archive.

### Naming the package

| Placeholder    | Value                                                 |
| -------------- | ----------------------------------------------------- |
| `{stem}`       | `--out`'s file name without its `.glb` suffix         |
| `{model}`      | The model id, with `/` replaced by `-`                |
| `{timestamp}`  | UTC `YYYYMMDD-HHmmss`, taken once before the fal call |
| `{requestId8}` | The first 8 characters of the fal request id          |

The default is `{stem}-{timestamp}`, for example `stone-knight-20261028-011838`.
The rendered value must be a plain file name: an unknown placeholder, an unclosed
brace, a path separator, `..`, or a character outside `[A-Za-z0-9._-]` is refused
before the paid call. `{requestId8}` is allowed, but the name cannot be known
until fal answers, so its collision check runs immediately after the call and
before anything from the run is written.

```bash
chatroom generate-3d \
  --platform=fal \
  --model meshy/v7.1/text-to-3d \
  --prompt "a weathered stone knight statue" \
  --out assets/models/stone-knight.glb \
  --name stone-knight \
  --package-dir dist/models
```

That writes `dist/models/stone-knight.zip` and `dist/models/stone-knight.html`.
Pass a name the user asks for through `--name` rather than renaming the output
afterwards; the two package files always share it.

### The zip

The zip holds exactly three entries, written in sorted order:

- `<stem>.glb` — the master, byte-for-byte what fal returned. It is never
  re-encoded, so this file is the one to archive.
- `web/<stem>.web.glb` — a welded copy with textures re-encoded as JPEG at
  `1024×1024`, simplified toward 30,000 triangles when the master is over that
  target. It adds no glTF extension, so any glTF 2.0 viewer can load it.
- `manifest.json` — the package manifest, described below.

The archive is reproducible: entries are sorted and every entry carries the same
fixed timestamp, so the same master and settings produce byte-identical bytes.

### The preview

`<base>.html` is a self-contained page for the **web variant**: the GLB is
embedded as a `data:model/gltf-binary;base64,...` URI, so it opens from `file://`
with no server and no sibling file. It loads only
[`@google/model-viewer@3`](https://cdn.jsdelivr.net/npm/@google/model-viewer@3/dist/model-viewer.min.js)
from jsDelivr and turns on orbit controls, auto-rotation, and shadows.

The caption above the viewer lists the model id, prompt, fal request id, the
master and web triangle counts, both sizes, the web variant's SHA-256, and the
sibling zip that holds the full-resolution master. Every value that comes from
the model, the prompt, the request, or the chosen name is HTML-escaped, so a
prompt containing markup shows as text.

The mesh itself is embedded, so the page works offline apart from the viewer
script; without network access the caption still renders and the viewer frame
stays empty.

## The sidecar manifest

Every mesh gets a `<out>.json` sidecar with the provenance of the generation.
`manifest.json` inside the package is a different, smaller document described in
[The package manifest](#the-package-manifest).

- `platform` — generation platform (`fal`).
- `tool` — `chatroom generate-3d`.
- `sdk` — the `@fal-ai/client` version used.
- `model` — the fal model id.
- `pageUrl` — the public fal model page the licence value was read from.
- `licenseType` — always `commercial`; copied verbatim from the fal catalog.
- `input` — exactly the fields sent to the model.
- `inputImage` — `{ source, url }` for `--input-image`, otherwise `null`.
- `requestId` — the fal request id.
- `output.path` — the absolute path of the written GLB.
- `output.sha256` — SHA-256 of the written bytes.
- `output.bytes` — the file size in bytes.
- `output.contentType` — `model/gltf-binary`.
- `textureUrls` — separate texture files the model returned; empty when the
  textures are embedded in the GLB (Trellis-2).
- `package` — `{ zip, html }`, the package files written beside the sidecar.
  Present once packaging succeeded.
- `generatedAt` — ISO timestamp of the generation.

With `--rig`, the manifest gains a `rigging` section:

- `rigging.endpoint` — the rigging endpoint that was called.
- `rigging.requestId` — the rigging request id, or `null` when fal returned none.
- `rigging.input` — exactly the rigging request body.
- `rigging.riggedGlbPath` and `rigging.riggedGlbUrl` — the saved rigged GLB and
  its fal URL.
- `rigging.riggedFbxUrl` — the FBX variant URL, or `null`.
- `rigging.basicAnimationUrls` — name → URL map for the basic walking/running
  variants. These are recorded only and are not downloaded.
- `rigging.animations` — one `{ actionId, path, glbUrl }` per requested clip, in
  the order given.
- `rigging.costLines` — the rigging cost lines, matching the printed estimate.

The `rigging` section is present only when the rigging step succeeded. A failed
rig leaves the generation-only manifest described above.

`licenseType` is the only licence field. It records the catalogue value, not a
claim about the licence or commercial rights of the generated output; check
fal's terms and the selected model's page yourself before using an asset in
production.

## The package manifest

`manifest.json` inside the zip describes the package rather than the call:

- `schemaVersion` — `1`.
- `package.name`, `package.zip`, `package.createdAt` — the rendered base name, the
  zip file name, and the ISO timestamp the zip was built.
- `generator.tool`, `generator.model`, `generator.requestId`,
  `generator.prompt`, `generator.inputImage` — the generator and its provenance.
  `prompt` is `null` for an image-to-3D run; `inputImage` is the path or URL the
  user gave, not the temporary fal storage URL.
- `variants` — one entry per file. `master` records the unchanged fal bytes;
  `web` also records its `settings` (`maxTexturePx`, `textureFormat`, `quality`,
  `triangleTarget`, `simplified`). Each entry carries `file`, `bytes`, `sha256`,
  `triangles`, `textures`, and `extensionsUsed`.
- `licence` — the model's catalogue licence value, copied from the registry.
- `pricing.estimatedTotalUsd` and `pricing.note` — the same list-price estimate
  the CLI printed, with the reminder that it is not a billed amount.

## Limits

- **One mesh per invocation.** The command generates one GLB from text or one
  reference image, then optionally rigs it. It does not do multi-asset batches or
  write textures as separate files.
- **Closed allowlist.** Only the four model ids in
  [Choose the model](#choose-the-model) are accepted. There is no free-form
  `--model` passthrough; a new model is a change to the
  `packages/cli/src/commands/generate-3d/model-registry.ts` allowlist.
- **Humanoid rigs only.** Rigging is Meshy's humanoid rigger. Non-humanoid
  meshes fail on fal and keep only the mesh.
- **Animation ids only.** Meshy publishes no preset name map, so clips are
  requested as numeric ids from 0 to 696.
- **No model parameters.** There is no `--input` escape hatch: the request body
  for each model is fixed. The resolution, texture mode, and PBR settings are the
  ones described in [Choose the model](#choose-the-model).
- **Always packaged.** A successful run always writes the zip and the preview;
  neither can be switched off. Use `--package-dir` to keep them out of the asset
  folder.
- **Preview needs the CDN.** The preview's mesh is embedded, but the model-viewer
  module comes from jsDelivr, so the viewer needs network access the first time
  the page is opened.
- **Paid calls.** Every real generation, rig, and clip is billed to your fal
  account. The command prints a static list-price estimate, but fal returns no
  billed cost; the estimate is not a bill. Check the fal dashboard for the
  actual charge.

## Troubleshooting

### `FAL_API_KEY is not set`

The command found no `FAL_API_KEY` in the environment. Export it in the shell
that runs the command and confirm with the check in [Setup](#setup). `FAL_KEY`
is not read, so exporting that name has no effect. `--dry-run` does not need the
key.

### `required option '--model <id>' not specified`

`--model` has no default. Pass `--model meshy/v7.1/text-to-3d` (or another id
from the allowlist).

### `Unknown --model <id>`

The id is not in the allowlist. The message lists every accepted id. Copy one
from the allowlist rather than editing the id.

### `--out must end with .glb`

The command writes a GLB mesh only. Rename the output to end in `.glb`.

### `--out already exists` / `Manifest already exists`

The output, its manifest, or a rigged/clip file is already on disk. Choose a new
path or add `--force` to replace them all.

### `Package already exists` / `Preview already exists`

The zip or the preview for the rendered base name is already on disk. Pick a new
`--name`, a new `--package-dir`, or add `--force` to replace both. When `--name`
uses `{requestId8}` this check runs right after the fal call, before any file from
the run is written.

### `Unknown --name placeholder` / `not a valid file name`

The `--name` template rendered something the command cannot use: an unknown
placeholder, an unclosed brace, a path separator, `..`, or a character outside
`[A-Za-z0-9._-]`. Use the placeholders in [Naming the package](#naming-the-package) and keep the
result to a plain file name.

### `Failed to build the web variant`

The glTF optimizer or its image encoder (`sharp`) failed, most often because the
native `sharp` binary is missing for this platform. The master GLB and its sidecar
manifest are kept, and no package files are written. Reinstall the CLI
(`npm install -g chatroom-cli@latest`) to get the matching binary, or run the same
command with `--force` after fixing the environment.

### `Failed to build the package zip` / `Failed to save the preview`

The zip could not be built or the preview could not be written. The master and
its sidecar are kept. If the preview write fails, the zip written moments earlier
is removed, so a package directory never holds a zip without its preview; the
message says so if the removal itself fails.

### `--animation-action-id requires --rig`

Animation clips are a rigging feature. Add `--rig`, or drop the clip ids.

### `--prompt is required for ...` / `--input-image is required for ...`

The model's input kind and the flags disagree. A text-to-3D model takes
`--prompt`; an image-to-3D model takes `--input-image`. Pass exactly one.

### `Unsupported --input-image extension`

Local reference images must be `.png`, `.jpg`, or `.jpeg`. Convert the file, or
pass an `http(s)` URL to an image fal can fetch.

### `Rigging failed ...`

The mesh was generated and saved. The message names the rigging endpoint, the
rigging request id when available, and the kept mesh path. Read the underlying
fal message: the most common cause is a non-humanoid mesh. The mesh and its
manifest are intact, so the mesh does not need to be paid for again if you can
rig it another way; re-running `generate-3d` does generate and bill a new mesh.

### `--package-dir` rejects the path

`--package-dir` must be a directory the process can create and write. The command
creates it before the paid call, so a permission error there fails before any
charge.

### `unsupported platform`

Only `--platform=fal` is supported today. Remove the flag or set it to `fal`.

## Security

- Do not commit the key, and do not add it to a `.env` file that is tracked by
  git.
- Do not paste the key into chat messages, tickets, or logs.
- If the key leaks, rotate it in the fal dashboard and update your shell
  profile.
- The manifest records request ids, input URLs, and output URLs. Treat a
  credential-bearing or presigned input URL as leaked the moment it is written.
