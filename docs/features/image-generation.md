# Image Generation (`chatroom generate-image`)

**Status:** Implemented
**Last Updated:** 2026-10-22

---

`chatroom generate-image` generates one image from a text prompt with a fal
text-to-image model and writes two files: the image at `--out`, and a JSON
manifest at `<out>.json`.

The recommended and default model is **`fal-ai/flux-2/flash`**, which produced
the best sprite-sheet output in testing. It returns a 1024x768 PNG (4:3) with
no alpha channel. You can pass a different fal model with `--model`.

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
  --prompt "pixel-art health potion, red glass, 32x32 sprite" \
  --out assets/sprites/health-potion.png \
  --force
```

Without `--force`, the command refuses before making the paid fal call.

### Choose another model

`--model` accepts any fal text-to-image model id. The default,
`fal-ai/flux-2/flash`, is recommended:

```bash
chatroom generate-image \
  --prompt "isometric treasure chest, muted palette" \
  --out assets/sprites/treasure-chest.png \
  --model fal-ai/flux/dev \
  --aspect-ratio 1:1
```

Only pass `--aspect-ratio` to models that support it; see
[Limits](#limits). The manifest records exactly the input that was sent.

### Other options

| Option              | Meaning                                                         |
| ------------------- | --------------------------------------------------------------- |
| `--platform <name>` | Generation platform. Only `fal` is supported (default).         |
| `--output-format`   | `png`, `jpeg`, or `webp` (omitted = the model's own default)    |
| `--seed <n>`        | Integer seed for reproducible output when the model supports it |
| `--force`           | Replace an existing output and manifest                         |

## The manifest

Every image gets a `<out>.json` sidecar with the provenance of the generation:

- `platform` — generation platform (`fal`).
- `tool` — `chatroom generate-image`.
- `sdk` — the `@fal-ai/client` version used.
- `model` — the fal model id.
- `input` — exactly the fields sent to the model.
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

## Limits

- **Text-to-image only.** The command generates one image per invocation. It
  does not do image editing, video, audio, or 3D.
- The command generates one image per invocation. For sheet workflows, see [image-slicing.md](image-slicing.md).
- **No segmentation.** Segment-anything (SAM) style masks and cutouts are not
  supported.
- **The default model ignores `--aspect-ratio`.** `fal-ai/flux-2/flash` takes
  its own `image_size` option (for example `square_hd`, `landscape_4_3`), which
  this command does not expose yet. The flag is only useful with other models.
- **PNG output by default.** The default model returns PNG without alpha.
- **Paid calls.** Each successful generation is billed to your fal account.

## Troubleshooting

### `FAL_API_KEY is not set`

The command found no `FAL_API_KEY` in the environment. Export it in the shell
that runs the command and confirm with the check in [Setup](#setup). `FAL_KEY`
is not read, so exporting that name has no effect.

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
