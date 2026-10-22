# Image Slicing (`chatroom slice-image`)

**Status:** Implemented
**Last Updated:** 2026-10-22

---

`chatroom slice-image` cuts one PNG sprite sheet into a regular grid of named
PNG tiles. Each tile gets its own JSON manifest, and a sheet index is written
last. Slicing is local and free: it never calls fal or any other network
service and does not read `FAL_API_KEY`.

Use it with [`chatroom generate-image`](image-generation.md) to turn one paid
generation into many assets: ask the model for one sheet, then slice it.

Confirm the command is available in your installed CLI:

```bash
chatroom slice-image --help
```

## Usage

```bash
chatroom slice-image \
  --in assets/sheets/dungeon.png \
  --out-dir assets/sprites/dungeon \
  --cols 4 \
  --rows 3
```

The sheet is 1024x768 (the default `generate-image` size), so a 4x3 grid gives
twelve 256x256 tiles:

```text
Sheet /path/to/assets/sheets/dungeon.png (1024x768, sha256 1a2b3c4d5e6f) -> 4x3 grid, tile 256x256
Sliced /path/to/assets/sprites/dungeon/dungeon-01.png (0,0 256x256)
...
Sliced /path/to/assets/sprites/dungeon/dungeon-12.png (768,512 256x256)
Index /path/to/assets/sprites/dungeon/dungeon.slices.json
```

`--out-dir` is created if it does not exist. A refused or failed-before-write
slice writes nothing. A mid-run write failure lists the files already written
and leaves them in place.

### Grammar

| Option              | Meaning                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `--in <path>`       | Source PNG sheet. Required.                                             |
| `--out-dir <dir>`   | Directory for tiles, tile manifests, and the sheet index. Required.     |
| `--cols <n>`        | Grid columns, integer 1-64. Required.                                   |
| `--rows <n>`        | Grid rows, integer 1-64. Required.                                      |
| `--margin <px>`     | Pixels skipped on all four sides of the sheet. Default `0`.             |
| `--gutter <px>`     | Pixels between adjacent cells on both axes. Default `0`.                |
| `--names <a,b,...>` | Row-major tile names. An empty entry skips that cell.                   |
| `--prefix <text>`   | Prefix for default names. Default: the sheet file stem.                 |
| `--allow-remainder` | Drop leftover right/bottom pixels instead of refusing a non-exact grid. |
| `--force`           | Overwrite existing tile images and manifests.                           |
| `--dry-run`         | Print what would be written; create nothing.                            |

`--names` and `--prefix` are mutually exclusive.

### Worked examples for the 1024x768 default sheet

| Grid    | Tile size | Notes                                    |
| ------- | --------- | ---------------------------------------- |
| `4 x 3` | 256x256   | Even division; twelve square tiles.      |
| `2 x 2` | 512x384   | Even division; four large tiles.         |
| `4 x 4` | 256x192   | Even division; sixteen landscape tiles.  |
| `3 x 2` | 341x384   | Leaves 1px on the right; needs the flag. |
| `3 x 3` | 341x256   | Leaves 1px on the right; needs the flag. |

A grid that does not divide the usable pixels is refused:

```text
Sheet 1024x768 does not divide into 3 cols x 2 rows (width remainder 1px, height remainder 0px). Use a grid that divides evenly, or pass --allow-remainder to drop the leftover pixels on the right/bottom.
```

With `--allow-remainder` the command succeeds, keeps the leftover pixels
unused, warns about them, and records them as `grid.droppedRight` and
`grid.droppedBottom` in the sheet index.

## Naming

Without `--names`, tiles are named `<prefix>-NN`, row-major and 1-based, where
`NN` is zero-padded to at least two digits (three digits for 100+ tiles). The
prefix defaults to the sheet file stem and has runs of unsafe characters
replaced with `-`. For example, `dungeon.png` sliced 2x2 gives `dungeon-01`
through `dungeon-04`.

Explicit names must be exactly `cols * rows` entries. Use `--names` followed by
a comma-separated, row-major list:

```bash
chatroom slice-image \
  --in assets/sheets/dungeon.png \
  --out-dir assets/sprites/dungeon \
  --cols 2 --rows 2 \
  --names hero,,potion,chest
```

The empty entry skips cell 2. Skipped cells are reported 1-based:

```text
Skipped cells: 2
```

Each non-empty name must match `[A-Za-z0-9_][A-Za-z0-9_-]{0,63}`. Names are
compared case-insensitively for duplicates, so `Hero` and `hero` collide. At
least one name must be non-empty.

## Manifests

Every tile writes `<name>.png` and `<name>.png.json`. The tile manifest records:

- `tool` — `chatroom slice-image`.
- `decoder` — the `pngjs` version used, for example `pngjs@6.0.0`.
- `source.path`, `source.sha256`, `source.bytes`, `source.width`,
  `source.height` — the sheet that was cut.
- `source.manifestPath`, `source.manifest` — the `<in>.json` sidecar from
  `generate-image` when present. The copied fields are `platform`, `model`,
  `requestId`, `seed`, `generatedAt`, `outputSha256`, and `sha256Matches`.
  A missing or unreadable sidecar is a warning, not a failure; `manifest` is
  `null` in that case.
- `grid` — `cols`, `rows`, `margin`, `gutter`, `row`, `col`, `index`.
- `crop` — `x`, `y`, `width`, `height` of the source region.
- `output.path`, `output.sha256`, `output.contentType`, `output.bytes`,
  `output.width`, `output.height`, `output.hasAlpha` — the written tile.
- `slicedAt` — ISO timestamp of the slice.
- `licensing` — always `unverified`.

The sheet index `<stem>.slices.json` is written last. It repeats `tool`,
`decoder`, `source`, and `slicedAt`, and records:

- `grid` — `cols`, `rows`, `margin`, `gutter`, `tileWidth`, `tileHeight`,
  `droppedRight`, `droppedBottom`.
- `tiles` — `index`, `row`, `col`, `name`, `path`, `manifestPath`, `sha256`
  for every written tile, in order.
- `skipped` — 0-based indexes of skipped cells.
- `licensing` — always `unverified`.

`sha256Matches` compares the sidecar's `output.sha256` with the sheet's actual
hash. A mismatch adds a warning and does not fail the slice, because the sheet
may have been edited after generation.

## What is refused

Nothing is written when the command refuses. Refusals include:

- `--in` is missing or is a directory.
- The input is not a PNG, is larger than 64 MiB, or decodes to more than
  100,000,000 pixels.
- The PNG cannot be decoded.
- `--cols` or `--rows` is outside 1-64, the grid produces more than 256 tiles,
  or the grid is too small for the requested margin and gutter.
- The grid does not divide the usable pixels exactly and
  `--allow-remainder` was not passed.
- `--names` has the wrong count, an unsafe name, a case-insensitive duplicate,
  or no non-empty entry.
- An output path is a directory, or an existing file that would be replaced
  without `--force`. Every conflict is listed in one error.
- An output path would overwrite the source sheet or its sidecar. This is
  refused even with `--force`.
- A mid-run write failure names the failed path, lists the files already
  written, and leaves them in place.

## Limits

- **PNG sheets only.** JPEG, WebP, and other inputs are refused. Tiles are
  written as RGBA PNGs.
- **No background removal, segmentation, trimming, padding, or scaling.** The
  crop is exact: every tile is `tileWidth x tileHeight` pixels copied verbatim
  from the grid, so output pixels match the source region.
- **Exact grids only.** Sprite positions are not detected. If sprites do not sit
  on the requested grid, the cuts run through them; inspect the tiles before
  using them.
- **Alpha is preserved.** An RGBA sheet keeps its alpha, and the tile manifest
  reports `hasAlpha`. An RGB sheet produces opaque tiles (`hasAlpha: false`).
  The default `generate-image` model returns PNG without alpha, so expect
  opaque tiles unless you generate with a model that supports transparency.
- **Local and offline.** The command makes no network call and does not read
  `FAL_API_KEY`.
- **Deterministic for a given toolchain.** The same input, options, CLI
  version, and pngjs/Node build produce identical tile bytes; another runtime
  may produce different compressed bytes. The tile and index manifests embed
  absolute paths, and `slicedAt` changes between runs.
- **Unverified licensing.** Tile and index manifests always record
  `licensing: unverified`. Check the model's terms before shipping assets.
