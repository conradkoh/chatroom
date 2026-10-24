# Image Generation (`chatroom generate-image`)

**Status:** Implemented
**Last Updated:** 2026-10-24

---

`chatroom generate-image` generates one image with a fal model and writes two
files: the image at `--out`, and a JSON manifest at `<out>.json`.

`--model` is required; there is no default. This guide uses FLUX 2 Flash:
`fal-ai/flux-2/flash` to generate from text, and `fal-ai/flux-2/flash/edit` to
edit an image with `--input-image`. Run a command with `--dry-run` first to see
the request and the constraints the CLI knows for the model.

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

### 2. Install or update the CLI

```bash
npm install -g chatroom-cli@latest
```

If the CLI is already installed, update it in place:

```bash
chatroom update
```

`generate-image` requires chatroom-cli 1.134.0 or later. Confirm the command is
available:

```bash
chatroom generate-image --help
```

## Usage

### Generate an image

```bash
chatroom generate-image \
  --model fal-ai/flux-2/flash \
  --prompt "pixel-art health potion, red glass, 32x32 sprite" \
  --out assets/sprites/health-potion.png
```

The command prints where it wrote both files:

```text
Generated /path/to/your/project/assets/sprites/health-potion.png
Manifest /path/to/your/project/assets/sprites/health-potion.png.json
```

Parent directories are created automatically.

### Overwrite an existing file

`--out` and `<out>.json` must not already exist. Pass `--force` to replace them:

```bash
chatroom generate-image \
  --model fal-ai/flux-2/flash \
  --prompt "pixel-art health potion, red glass, 32x32 sprite" \
  --out assets/sprites/health-potion.png \
  --force
```

Without `--force`, the command refuses before making the paid fal call.

### Choose the model

Pass the model id with `--model`; the command fails without it
(`error: required option '--model <id>' not specified`).

| Model id                   | Use                                       |
| -------------------------- | ----------------------------------------- |
| `fal-ai/flux-2/flash`      | Generate from a text prompt               |
| `fal-ai/flux-2/flash/edit` | Edit one image given with `--input-image` |

`--input-image` requires an edit model, and `fal-ai/flux-2/flash/edit` requires
`--input-image`; a mismatched pair is refused before any upload or fal call.
Other fal model ids are passed through unchanged, but the CLI has no capability
data for them. The manifest records exactly the input that was sent.

### Check a request first (`--dry-run`)

`--dry-run` runs every check the real command runs, then prints the model, the
output paths, the exact request JSON, and the model's constraints, without
uploading anything or calling fal. It does not need `FAL_API_KEY`.

Each constraint line is `unsupported` (the model does not take that parameter),
`unknown` (the CLI has no data for it), `default` (an unset parameter where the
model's default applies), or `note`. A real call still sends an `unsupported`
parameter and prints it as a warning, because fal's schema can change; only the
model and flag pairing checks are errors.

```bash
chatroom generate-image --model fal-ai/flux-2/flash --prompt "pixel-art health potion" --out assets/sprites/health-potion.png --dry-run
```

### Other options

| Option              | Meaning                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `--platform <name>` | Generation platform. Only `fal` is supported (default).                            |
| `--output-format`   | `png` or `webp` (omitted = the model's own default); both keep transparency        |
| `--seed <n>`        | Integer seed for reproducible output when the model supports it                    |
| `--force`           | Replace an existing output and manifest                                            |
| `--dry-run`         | Validate and print the request and the model's constraints; no upload, no fal call |

## Editing an image

Pass `--input-image` to edit an existing image with
`--model fal-ai/flux-2/flash/edit` instead of generating from text alone:

```bash
chatroom generate-image \
  --model fal-ai/flux-2/flash/edit \
  --prompt "make the sky stormy with distant lightning" \
  --input-image ./assets/sprites/hero.png \
  --out assets/sprites/hero-stormy.png
```

`--input-image` accepts two forms:

- A local file with a `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif` extension. The
  file is uploaded to fal storage with a one-day lifetime, and only the returned
  URL is sent to the model. Any other extension is rejected before the upload.
- A public `http(s)` URL. It is passed to fal unchanged, so it must be reachable
  without authentication for the duration of the call.

`--input-image` requires an edit model such as `fal-ai/flux-2/flash/edit`. Pass
size and other model parameters with `--input`; run the command with `--dry-run`
to see which parameters the model takes and its defaults:

```bash
chatroom generate-image \
  --model fal-ai/flux-2/flash/edit \
  --prompt "make the sky stormy" \
  --input-image ./assets/sprites/hero.png \
  --input '{"image_size":"landscape_4_3"}' \
  --out assets/sprites/hero-stormy.png
```

The manifest records the input in `inputImage`: `source` is the local absolute
path or the URL exactly as given, and `url` is the value sent to fal in
`image_urls`. Without `--input-image`, `inputImage` is `null`. `image_urls` is
reserved in `--input`; pass the input image with `--input-image` instead.

The URL is written verbatim to `<out>.json` in both `inputImage.url` and
`input.image_urls`, so do not use presigned or credential-bearing URLs for
assets that will be committed. An uploaded file's URL expires after one day, so
the recorded `inputImage.url` and `input.image_urls` stop working after that.

## Keep one perspective across a set

Assets used together, such as the tiles of one level or the sprites of one
character, should share one camera perspective. Consistency comes from the
prompt and from sending the same request settings on every call. Run the first
command of a set with `--dry-run` and follow its constraints. Check every result
by eye, generate several variations, and keep only the ones that match.

These prompt practices are community practice, not verified, with no guarantee:

- Name one perspective and repeat it word for word in every prompt of the set:
  `side view`, `front view`, `orthographic top-down`, `orthographic isometric`,
  `dimetric 2:1`, or `three-quarter view`.
- Add the same flattening terms to every prompt: `flat 2D game asset`,
  `orthographic`, `no perspective`, `centered`, `plain background`,
  `even lighting`.
- Send the same `--input` JSON on every call, including one explicit size when
  the dry run reports a size default.
- Reusing one `--seed` may reduce variation between calls, but the same seed
  does not keep the perspective when the prompt changes.
- To match an existing asset, try `--model fal-ai/flux-2/flash/edit` with
  `--input-image <existing-asset>`; the dry run lists what the edit model does
  not guarantee.

```bash
chatroom generate-image \
  --model fal-ai/flux-2/flash \
  --prompt "health potion, orthographic front view, flat 2D game asset, centered, plain background, even lighting" \
  --input '{"image_size":"square_hd"}' \
  --seed 42 \
  --out assets/sprites/health-potion.png
```

## The manifest

Every image gets a `<out>.json` sidecar with the provenance of the generation:

- `platform` — generation platform (`fal`).
- `tool` — `chatroom generate-image`.
- `sdk` — the `@fal-ai/client` version used.
- `model` — the fal model id.
- `input` — exactly the fields sent to the model.
- `inputImage` — `{ source, url }` for `--input-image`, otherwise `null`.
- `requestId` — the fal request id, if returned.
- `seed` — the seed fal resolved, else the requested seed, else `null`.
- `output.path` — the absolute path of the written image.
- `output.sha256` — SHA-256 of the written bytes.
- `output.contentType` — the downloaded content type.
- `output.bytes` — the file size in bytes.
- `generatedAt` — ISO timestamp of the generation.
- `licensing` — always `unverified`.

`licensing` stays `unverified` because the command makes no claim about the
licence or commercial rights of generated output. Check fal's terms and the
selected model's terms yourself before using an asset in production.

## Background removal (fal.ai)

`remove-image-background-fal` cuts one subject out of a PNG with
[fal-ai/bria/background/remove](https://fal.ai/models/fal-ai/bria/background/remove)
by default and writes a PNG with alpha plus a `<out>.json` manifest:

```bash
chatroom remove-image-background-fal \
  --in assets/sprites/health-potion.png \
  --out assets/sprites/health-potion-cutout.png
```

| Option     | Meaning                                     |
| ---------- | ------------------------------------------- |
| `--in`     | Input PNG (required)                        |
| `--out`    | Output PNG with alpha (required)            |
| `--engine` | `bria` (default) or `birefnet`              |
| `--force`  | Replace an existing output and its manifest |

The default `bria` engine calls
[fal-ai/bria/background/remove](https://fal.ai/models/fal-ai/bria/background/remove).
fal lists a fixed price of about $0.018 per call (read 2026-10-23); check the
model page and your fal dashboard for the current rate. The optional prompt
mode is not exposed, so that per-call price is the one this command uses.

Pass `--engine birefnet` to run the previous backend,
[fal-ai/birefnet/v2](https://fal.ai/models/fal-ai/birefnet/v2) in `Matting` mode:

```bash
chatroom remove-image-background-fal \
  --in assets/sprites/health-potion.png \
  --out assets/sprites/health-potion-cutout.png \
  --engine birefnet
```

birefnet is billed per compute-second rather than per call.

The source is sent as a base64 data URI, so there is no separate upload step.
Both engines write a PNG with alpha. The command prints the output path, the
manifest path, and the fal request id. The manifest records the engine, the
model, the source and output SHA-256 hashes, and the request id.

- **Input cap:** 8 MiB.
- **Result cap:** 32 MiB; anything larger is rejected before writing.
- **Dimensions:** the output must match the input's width and height. A
  mismatch fails without writing anything, because a resized tile sheet would
  shift every tile's grid position. Re-run with `--engine birefnet`, or resize
  the sheet so the engine accepts it; the command refuses rather than resizing.
- **Licensing:** `unverified` in the manifest for both engines, as with
  `generate-image`. Check the
  [bria model page](https://fal.ai/models/fal-ai/bria/background/remove), the
  [BiRefNet model page](https://fal.ai/models/fal-ai/birefnet/v2), and fal's
  terms before using an asset in production.

The local `remove-image-background` command is different: it is colour-key only,
runs offline, and needs no `FAL_API_KEY`. Use it for flat, uniform backgrounds.
The fal command handles photographic or textured backgrounds where colour
keying fails.

## Limits

- **One image per invocation.** The command generates from text, or edits one
  input image with `--input-image`. It does not do video, audio, or 3D.
- **No segmentation.** Segment-anything (SAM) style masks and cutouts are not
  supported.
- **`--aspect-ratio` is checked against the model.** It is refused for models
  the CLI knows do not take it, including both FLUX 2 Flash ids; `--dry-run`
  names the size parameter to use instead.
- **Paid calls.** Each successful generation is billed to your fal account.

## Troubleshooting

### `FAL_API_KEY is not set`

The command found no `FAL_API_KEY` in the environment. Export it in the shell
that runs the command and confirm with the check in [Setup](#setup). `FAL_KEY`
is not read, so exporting that name has no effect.

### `required option '--model <id>' not specified`

`--model` has no default. Pass `--model fal-ai/flux-2/flash`, or `--model
fal-ai/flux-2/flash/edit` with `--input-image`.

### `--out already exists`

The output or its manifest is already on disk. Choose a new path or add
`--force` to replace both files.

### `unsupported platform`

Only `--platform=fal` is supported today. Remove the flag or set it to `fal`.

## Security

- Do not commit the key, and do not add it to a `.env` file that is tracked by
  git.
- Do not paste the key into chat messages, tickets, or logs.
- If the key leaks, rotate it in the fal dashboard and update your shell
  profile.
