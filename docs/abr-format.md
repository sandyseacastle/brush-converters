> [!WARNING]
> **AI disclosure:** This is entirely AI generated.

# Photoshop `.abr` brush files

This is what `lib/photoshop/` reads. Adobe has never published the format beyond
Photoshop 6, so it comes from three places:

- ag-psd's ABR reader (MIT), whose four test files and expected parses are vendored in
  `tests/fixtures/abr/`;
- the readers in Krita and GIMP, which only take the tip images;
- for the folders, a PhotoCraft issue (storytold/photocraft#1851).

The fixtures were checked field by field and pixel by pixel. The Krita side was checked
by importing converted bundles into Krita 5.3.4 and 6.0 and painting with every preset.
Each section says how sure we are.

All integers are big-endian. A *Unicode string* is a `u32` count of UTF-16BE code units,
usually ending in a NUL. A *Pascal string* is a `u8` length followed by ASCII.

## Versions — **certain**

The file starts with `u16 version`:

| Version | Written by | Layout |
|---|---|---|
| 1, 2 | Photoshop 6 and earlier | `u16 count`, then that many brush records |
| 6, 7, 9, 10 | Photoshop 7 to CC | `u16 subversion` (1 or 2), then `8BIM` sections |

## Version 1 and 2 records — **certain** for sampled, **very likely** for computed

```
u16 type (1 computed, 2 sampled)   u32 length of what follows
computed: u32 misc, u16 spacing %, [v2: Unicode name], u16 diameter, u16 roundness %,
          i16 angle, u16 hardness %
sampled:  u32 misc, u16 spacing %, [v2: Unicode name], u8 antialias,
          4 × i16 bounds, 4 × i32 bounds (top, left, bottom, right), u16 depth,
          u8 compression, pixels
```

Krita and GIMP skip computed brushes, so whether v2 computed records carry a name isn't
documented anywhere. The reader looks for one only when there are more than 8 bytes
left after the spacing.

## Sections (version 6 and later) — **certain**

Each section is `'8BIM'`, a four-character key and a `u32` length, padded to 4 bytes.

| Key | Contents |
|---|---|
| `samp` | Tip images |
| `patt` | Patterns, for the Texture option |
| `desc` | `u32 16`, then an action descriptor whose `Brsh` list holds the presets |
| `phry` | `u32 16`, then a descriptor whose `hierarchy` list holds the Brushes panel folders (Photoshop 2018+) |

## Tip images (`samp`) — **certain**

```
u32 length (the entry is padded to 4 bytes)
Pascal string: the UUID that presets refer to (sampledData)
10 bytes (subversion 1: short bounds + unknown) or 264 bytes (subversion 2: unknown)
4 × i32 bounds: top, left, bottom, right
u16 depth (8 or 16)   u8 compression (0 raw, 1 RLE)
pixels: raw, or u16 byte count per row followed by PackBits rows
```

The pixels are a coverage mask where 255 means full paint. For 16-bit tips, the reader
keeps the high byte. Tips that no preset uses become plain presets, as in Krita's own
import.

## Patterns (`patt`) — **certain** for gray and RGB, **very likely** for indexed

These are the same records as in a `.pat` file:

```
u32 length (padded to 4)   u32 version (1)   u32 colour mode (1 gray, 2 indexed, 3 RGB, …)
i16 height, i16 width   Unicode name   Pascal string UUID
indexed only: 256 × RGB palette, then 4 bytes
virtual memory array list: u32 version (3), u32 length, 4 × i32 rectangle, u32 channels,
  then for each channel plus two masks: u32 written; if written: u32 length, u32 depth,
  4 × i32 rectangle, u16 depth, u8 compression, pixels (as in samp)
```

Preset patterns are named like `$$$/Presets/Patterns/…/GrayGranite=Gray Granite`. The
part after `=` is the display name.

## Action descriptors — **certain**

A descriptor is: Unicode class name, class ID, `u32` item count, then the items. Each
item is a key, a four-character type and a value.

- **IDs:** class IDs and keys are a `u32` length followed by ASCII. A length of 0 means a
  four-character code follows.
- **Types the reader handles:** `Objc`/`GlbO` (nested descriptor), `VlLs` (list), `doub`,
  `UntF` (unit + double: `#Pxl`, `#Prc`, `#Ang`), `TEXT`, `enum` (type ID + value ID),
  `long`, `comp`, `bool`, `tdta`/`alis` (raw bytes), `type`/`GlbC` (class) and `obj `
  (reference).

## Brush presets (`desc` › `Brsh`) — **certain** for the keys below

Each preset is a `brushPreset` object.

**The tip:** `Brsh` has one of these classes:

| Class | Tip | Keys |
|---|---|---|
| `computedBrush` | Generated round tip | `Dmtr` diameter, `Hrdn` hardness, `Angl`, `Rndn` roundness, `Spcn` spacing, `Intr` (spacing on), `flipX`, `flipY` |
| `sampledBrush` | Image tip | the same keys, plus `sampledData` (UUID into `samp`) |
| `dBrush` | Bristle (CS5+) | `Shp `, density, length, stiffness… |
| `dTips` | Erodible / airbrush (CC) | `dtipsType`, `dtipsHardness`, … |

**Dynamics blocks:** a `brVr` object holds:
- `bVTy`, the control: off, fade, pen pressure, pen tilt, stylus wheel, initial direction,
  direction, initial rotation, rotation
- `fStp`, the fade steps
- `jitter` %
- `Mnm `, the minimum %

**Option groups:** each Photoshop panel is a flag plus the keys it switches on.

| Flag | Option | Keys |
|---|---|---|
| `useTipDynamics` | Shape Dynamics | `szVr` (size), `minimumDiameter`, `angleDynamics`, `roundnessDynamics`, `minimumRoundness`, `flipX`/`flipY` (random flips), `tiltScale`, `brushProjection` |
| `useScatter` | Scattering | `scatterDynamics` (its jitter is the scatter amount), `bothAxes`, `Cnt ` count, `countDynamics` |
| `useTexture` | Texture | `Txtr` {`Nm  `, `Idnt` UUID into `patt`}, `textureScale`, `textureBrightness`, `textureContrast`, `textureDepth`, `minimumDepth`, `textureDepthDynamics`, `InvT`, `textureBlendMode`, `TxtC` (texture each tip) |
| `dualBrush.useDualBrush` | Dual Brush | `Brsh` (its own tip, with its own spacing), `BlnM` mode, `Flip`, `useScatter`, `Cnt `, `bothAxes`, `scatterDynamics` |
| `usePaintDynamics` | Transfer | `opVr` opacity, `prVr` flow, `wtVr` wetness, `mxVr` mix |
| `useColorDynamics` | Color Dynamics | `clVr` (foreground/background), `H   `, `Strt`, `Brgh`, `purity`, `colorDynamicsPerTip` (CC; before CC it was always per tip) |

**Flags without a group:**
- `Wtdg` wet edges
- `Nose` noise
- `Rpt ` airbrush
- `useBrushPose`

**Tool options:** brushes saved from CC can carry `toolOptions` with:
- `Opct` and `flow` (plain numbers)
- `Md  ` blend mode
- `smoothing`/`smoothingValue`
- `usePressureOverridesSize`/`usePressureOverridesOpacity`

The class is `PbTl` for brushes, `MixB` for mixer brushes and `SmTl` for smudge.

**Spacing:** the brush preset's top-level `Spcn` (and the dual brush's) belongs to
scattering and is always 100% in the files we've seen. The dab spacing is the tip's `Spcn`.

## Brushes panel folders (`phry`) — **likely**

`hierarchy` is a list read as a token stream:
- `Grup` {`Nm  `, `zuid`} opens a folder
- `preset` {} stands for the next entry of `Brsh`
- `groupEnd` {} closes the folder

Presets outside any folder are at the top level. Nested folders are assumed to nest
these tokens; no real nested file has been checked. If the tokens don't add up to the
number of presets, the reader ignores the folders and says so.

## How it maps to Krita

See `lib/krita/from-photoshop.js`. Points that were checked in Krita:

- **Angle:** Photoshop's angle (counter-clockwise) and Krita's tip angle turn the same way.
- **Texture:** neither app inverts by default; both put more paint where the pattern is light.
- **Scattering:** with "Both Axes" off, Photoshop scatters across the stroke. That's Krita's
  Scatter Y axis alone, which Krita applies along the normal to the drawing direction.
- **Rotation:** Krita treats a drawing-angle sensor as an absolute offset and a random sensor
  as additive, and only the additive part is scaled by the option's strength. So "direction
  + jitter" becomes a drawing-angle sensor plus a random sensor whose curve spans
  0.5 ± jitter / 2, at full strength.
- **Colour:** Krita's Mix is 1 for the foreground colour. Hue, saturation and value shift by
  ±strength (hue in units of 180°).
- **Tags:** the folder paths become per-preset tags in the bundle manifest, and Krita
  creates them on import.

Scatter amounts are approximate: Krita moves each dab up to ±amount × the diameter, and
Photoshop's percentage is used as that amount.
