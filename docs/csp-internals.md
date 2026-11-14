> [!WARNING]
> **AI disclosure:** This is entirely AI generated.

# Clip Studio Paint `.sut` internals (decoded)

This is what the converters in this project actually read. It was worked out by
taking apart 30 real `.sut` brushes from CSP 2.x (Korsse's free sets) and checking the
results against CSP's own material thumbnails, and against Krita by importing and
painting with the converted brushes. Nothing here comes from Celsys documentation.
Each section says how sure we are.

Reference implementations: `lib/csp/*.js` (browser) and `python/sut2krita/` (CLI).
Both decode the same samples identically, and `tests/js/parity.test.js` checks this.

## The `.sut` database — **certain**

A `.sut` is a plain SQLite 3 database.

| Table | Use |
|---|---|
| `Manager` | Tool type, version, root node UUID |
| `Node` | One row per sub tool. `NodeName` is the brush name; `NodeVariantID` is its current settings (`NodeInitVariantID` holds the defaults). Brush rows are the ones with `NodeVariantID != 0`. |
| `Variant` | One row per settings set, keyed by `VariantID`. About 185 columns; for example `BrushSize`, `Opacity`, `BrushFlow`, `BrushInterval` and `BrushRotation`, plus binary `*Effector` columns. |
| `MaterialFile` | Embedded images: `OriginalPath` (the reference key) and `FileData` (a tar archive). |

## Image references — **certain**

The `BrushPatternImageArray`, `TextureImage` and `DualPatternImageArray` columns are
lists of material references. All integers are big-endian:

```
u32 header size (8)   u32 count
per item:
  u32 item length (including itself)
  u32 path byte length, path in UTF-16LE   -> MaterialFile.OriginalPath
  u32 (2)
  u32 name byte length, name in UTF-16LE    -> display name, e.g. "skewstar 3"
  … catalog path etc.
```

## Materials — **certain**

`MaterialFile.FileData` is a POSIX tar archive containing:

- `data/material_0.layer` (sometimes `material.layer`): the pixels.
- `thumbnail/thumbnail.png`: a preview of about 300 px. Older converters used only this file.
- `catalog.zip`, `info.zip` (encrypted), and `icedata/layerData.xml` (material tags such as
  `BrushPattern` and `PaperTexture`).

### `.layer` = C2F container — **certain** (except the cipher)

```
8 bytes  89 43 32 46 0D 0A 1A 0A          ("\x89C2F\r\n\x1a\n")
chunks:  u32 LE length | 4-byte type | data | u32 LE crc32(type + data)
         HEAD (empty), dATA, dATA, …, TAIL (empty)
```

The `dATA` chunks, concatenated after a 2-byte flag each, form a **SQLite database with
4096-byte pages**.

- **Flag 0:** the rest of the chunk is plaintext.
- **Flag 1:** the chunk is encrypted, laid out as 2-byte flag + 8-byte nonce + ciphertext. In every
  sample, only the first chunk is encrypted, and it always covers exactly the first
  **5120 bytes**: page 1 (SQLite header and `sqlite_master` root) plus the first quarter of
  page 2.

We don't decrypt anything. The remaining pages are ordinary SQLite b-tree pages, so the
decoder walks every table-leaf page (type `0x0D`), follows overflow chains, and decodes the
records directly. Tables seen include `Canvas`, `CanvasPreview`, `Layer`, `Mipmap`,
`MipmapInfo`, `Offscreen` and `ParamScheme`. The text encoding is UTF-8 in most layers
and UTF-16 in some.

`CanvasPreview` holds a PNG, but in every sample it was fully transparent. The pixels
live in `Offscreen`.

### `Offscreen` rows — **certain**

`Attribute` blob (big-endian):

```
u32 16, u32 0x66, u32 0x2A, u32 n
u32 9, "Parameter" (UTF-16BE)
u32 width, u32 height, u32 blocks across, u32 blocks down
u32 17 | 33, u32 1, u32 channels (1 | 4), u32 bytes per pixel class (1 | 2 | 5), …
"InitColor" …, "BlockSize" …, then one u32 compressed size per block
```

`BlockData` blob: a sequence of block records, then a trailer.

```
u32 record length | u32 19 | "BlockDataBeginChunk" (UTF-16BE)
u32 block index | u32 uncompressed size | u32 256 | u32 256 | u32 not-empty
if not-empty: u32 BE (zlib length + 4) | u32 LE zlib length | zlib data
u32 17 | "BlockDataEndChunk"
…
u32 11 | "BlockStatus" …   (trailer: stop here)
u32 13 | "BlockCheckSum" …
```

Blocks are 256×256 tiles, laid out row-major across the grid. The uncompressed size gives
the pixel format:

| Size per tile | Layout | Seen in |
|---|---|---|
| 256·256·2 | alpha plane, then 8-bit gray plane | most tips and textures |
| 256·256/4 | 1-bit alpha plane, then 1-bit tone plane (MSB first, 1 = white) | pixel-art tips |
| 256·256·5 | alpha plane, then BGRA | colour layers |

A layer usually has several `Offscreen` rows: the root folder, the pixel layer and mipmaps.
Pick the row with the most non-empty blocks, and break ties by area. The decoded images
match CSP's own thumbnails.

## Tip shape — **very likely**

CSP takes a tip's shape from **transparency**, not from darkness. Several working brushes
use white-on-transparent tips, such as a white circle or a white square as the main tip,
and those would paint nothing if white meant empty. Only when an image is fully opaque and
its tones vary do we use darkness (`255 − gray`) as density. Paper textures are read as
they look: transparent areas count as white, and darker means more paint. The
"darker = more paint" part of that is inferred.

## Effectors (dynamics) — **likely**

Every dynamics-capable parameter has an `*Effector` blob. All integers are big-endian int32.

```
[0] 44 (header size)        [1] available inputs mask (0xF0 / 0x1F0)
[2] enabled inputs: 0x10 pressure, 0x20 tilt, 0x40 velocity, 0x80 random
[3] pressure minimum %      [4] tilt minimum %
[5] velocity minimum %      [6] random minimum %
[8] byte offset of the pressure curve (0 = linear)
[9] byte offset of a second (velocity) curve
[10] 500 or 100
curve: u32 12 | u32 point count | u32 16 | count × (float64 x, float64 y)
```

Output = `minimum + (1 − minimum) × curve(input)`. The bit meanings and the
minimum-to-bit pairing come from comparing brushes. The order of tilt and velocity is the
least certain part.

## Enumerations — **inferred**

| Column | Values |
|---|---|
| `BrushAutoIntervalType` | 0 = fixed (`BrushInterval` is a % of brush size); 1 / 2 / 3 = automatic wide / normal / narrow. Custom interval values only ever appear with type 0, and continuous line brushes use type 3. |
| `BrushRotationEffector` | Bitmask in the same style as the effectors. 0x40 = follow stroke direction, 0x80 = random, 0x10 = pressure. Bits 0x01 and 0x02 are always set. |
| `BrushSizeUnit` | 0 = pixels (all samples). |
| `AntiAlias` | 0 = off (pixel-art brushes), 1 to 3 = on. |
| `TextureCompositeMode` | 0 = multiply and 1 = subtract are assumed; other values are unknown. |
| `TextureForPlot` | Inferred to be "apply texture to each tip" ("plot" is a dab); 0 in every sample, where the texture covers the stroke as a whole. The Krita converter then uses Subtract mode, because Krita textures each dab and Multiply builds back up to solid paint at tight spacing. |
| `TextureBrightness` / `TextureContrast` | 100 = neutral. |
