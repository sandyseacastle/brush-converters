// Generic Krita Pixel-brush ("paintbrush") preset building blocks, shared by every
// converter that writes Krita presets. lib/krita/mapping.js (CSP) and
// lib/krita/from-procreate.js (Procreate) put the source-specific logic on top.

import { base64, hex, md5 } from '../bytes.js';
import { masksToGih } from './gih.js';

export const OPTIONS = ['Size', 'Opacity', 'Flow', 'Rotation', 'Ratio', 'Scatter', 'Spacing', 'Softness',
  'Sharpness', 'Mirror', 'Darken', 'Mix', 'h', 's', 'v', 'Rate'];
export const MASK_OPTIONS = ['Size', 'Opacity', 'Flow', 'Rotation', 'Ratio', 'Scatter', 'Mirror'];
// Opacity and Flow are always on in Krita; "<Option>UseCurve" decides whether their sensors
// apply. The other options are switched on by "Pressure<Option>".
export const ALWAYS_ON = ['Opacity', 'Flow'];
export const LINEAR = [[0, 0], [1, 1]];

/** Collects brush tips and patterns, de-duplicating identical files. */
export class ResourcePool {
  constructor() {
    this.resources = [];
    this.byMd5 = new Map();
    this.names = new Set();
  }

  add(kind, name, data) {
    const digest = hex(md5(data));
    if (this.byMd5.has(digest)) return this.byMd5.get(digest).filename;
    const s = slug(name), dot = s.lastIndexOf('.');
    const stem = s.slice(0, dot), ext = s.slice(dot + 1);
    let filename = `${stem}.${ext}`;
    for (let n = 2; this.names.has(`${kind}/${filename.toLowerCase()}`); n++) filename = `${stem}_${n}.${ext}`;
    this.names.add(`${kind}/${filename.toLowerCase()}`);
    const res = { kind, filename, data };
    this.resources.push(res);
    this.byMd5.set(digest, res);
    return filename;
  }
}

export function slug(name) {
  const s = name.replace(/[^\p{L}\p{N}_.\- ]+/gu, '_').replace(/^[ ._]+|[ ._]+$/g, '');
  return s.replace(/\s+/g, '_') || 'brush';
}

/** Exact decimal digits of a finite double: value = 0.DIGITS × 10^point. */
function exactDigits(v) {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7FFn);
  let mant = bits & ((1n << 52n) - 1n);
  let e2 = expBits - 1075;
  if (expBits) mant |= 1n << 52n; else e2 = -1074;
  let digits, point;
  if (e2 >= 0) { digits = (mant << BigInt(e2)).toString(); point = digits.length; }
  else { digits = (mant * 5n ** BigInt(-e2)).toString(); point = digits.length + e2; }
  const lead = digits.length - digits.replace(/^0+/, '').length;
  return { digits: digits.slice(lead).replace(/0+$/, '') || '0', point: point - lead };
}

/** Python's "%.6g": 6 significant digits, round-half-even, trailing zeros stripped. */
export function fmt(v, precision = 6) {
  if (v === 0) return '0';
  let { digits, point } = exactDigits(v);
  if (digits.length > precision) {
    const head = digits.slice(0, precision), rest = digits.slice(precision);
    let n = BigInt(head);
    const tie = rest[0] === '5' && /^5$/.test(rest.replace(/0+$/, ''));
    if (rest[0] > '5' || (rest[0] === '5' && (!tie || n % 2n === 1n))) n += 1n;
    let s = n.toString();
    if (s.length > precision) { s = s.slice(0, precision); point += 1; }
    digits = s.replace(/0+$/, '') || '0';
  }
  const exp = point - 1;
  const sign = v < 0 ? '-' : '';
  if (exp < -4 || exp >= precision) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return sign + digits + '0'.repeat(point - digits.length);
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

export const xmlAttr = (v) => `"${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}"`;
const curveText = (points) => points.map(([x, y]) => `${fmt(x)},${fmt(y)};`).join('');

/** sensors: [[id, points | null, attrs | null]] */
export function sensorXml(sensors) {
  const element = (tag, [sid, points, attrs]) => {
    const extra = Object.entries(attrs || {}).map(([k, v]) => ` ${k}=${xmlAttr(v)}`).join('');
    if (points == null) return `<${tag} id="${sid}"${extra}/>`;
    return `<${tag} id="${sid}"${extra}> <curve>${curveText(points)}</curve> </${tag}>`;
  };
  if (!sensors.length) return '<!DOCTYPE params> <params id="pressure"/> ';
  if (sensors.length === 1) return `<!DOCTYPE params> ${element('params', sensors[0])} `;
  return `<!DOCTYPE params> <params id="sensorslist"> ${sensors.map((s) => element('ChildSensor', s)).join(' ')} </params> `;
}

export const flat = (v) => [[0, v], [1, v]];

export function defaultParams(prefix = '', options = OPTIONS) {
  const p = {};
  for (const opt of options) {
    p[`${prefix}${opt}Sensor`] = sensorXml([]);
    p[`${prefix}${opt}UseCurve`] = 'false';
    p[`${prefix}${opt}UseSameCurve`] = 'true';
    p[`${prefix}${opt}Value`] = '1';
    p[`${prefix}${opt}curveMode`] = '0';
    if (!ALWAYS_ON.includes(opt)) p[`${prefix}Pressure${opt}`] = 'false';
  }
  p[`${prefix}ScatterValue`] = '5';
  p[`${prefix}Scattering/AxisX`] = 'true';
  p[`${prefix}Scattering/AxisY`] = 'true';
  p[`${prefix}HorizontalMirrorEnabled`] = 'false';
  p[`${prefix}VerticalMirrorEnabled`] = 'false';
  return p;
}

export function baseParams() {
  return Object.assign(defaultParams(), {
    'ColorSource/Type': 'plain',
    CompositeOp: 'normal',
    EraserMode: 'false',
    'KisPrecisionOption/AutoPrecisionEnabled': 'true',
    'KisPrecisionOption/DeltaValue': '15',
    'KisPrecisionOption/SizeToStartFrom': '10',
    'KisPrecisionOption/precisionLevel': '5',
    'MaskingBrush/Enabled': 'false',
    'MaskingBrush/MaskingCompositeOp': 'multiply',
    'MaskingBrush/MasterSizeCoeff': '1',
    PaintOpAction: '2',
    'PaintOpSettings/ignoreSpacing': 'false',
    'PaintOpSettings/isAirbrushing': 'false',
    'PaintOpSettings/rate': '20',
    'PaintOpSettings/updateSpacingBetweenDabs': 'false',
    'PressureTexture/Strength/': 'false',
    'Sharpness/threshold': '4',
    'Spacing/Isotropic': 'false',
    'Texture/Pattern/Enabled': 'false',
    paintop: 'paintbrush',
  });
}

export function setOption(params, option, sensors, value = null, prefix = '') {
  if (!ALWAYS_ON.includes(option)) params[`${prefix}Pressure${option}`] = 'true';
  params[`${prefix}${option}Sensor`] = sensorXml(sensors);
  params[`${prefix}${option}UseCurve`] = 'true';
  // With "share curve" on, Krita gives every sensor in a list one common curve (linear unless
  // <Option>commonCurve says otherwise) and drops the per-sensor curves written here.
  params[`${prefix}${option}UseSameCurve`] = 'false';
  if (value != null) params[`${prefix}${option}Value`] = fmt(value);
}

export const radians = (deg) => (((deg % 360) + 360) % 360) * Math.PI / 180;

export async function buildTip(materials, size, spacing, angleDeg, hardness, note, pool, label, randomOrder,
  maxTip, warnings, imaging) {
  const angle = fmt(radians(angleDeg));
  const masks = [];
  for (const mat of materials) {
    const tip = await imaging.tipMask(mat.image, maxTip);
    if (!tip) { warnings.push(`${note} image '${mat.name}' is empty`); continue; }
    masks.push({ mat, ...tip });
  }
  if (masks.length === 1) {
    const { mat, mask, png } = masks[0];
    const filename = pool.add('brushes', `${label} ${mat.name}.png`, png);
    const xml = `<Brush type="png_brush" filename=${xmlAttr(filename)} scale="${fmt(size / mask.width)}" `
      + `spacing="${fmt(spacing)}" angle="${angle}" useAutoSpacing="0" autoSpacingCoeff="1" BrushVersion="2"/>`;
    return { xml, files: [filename], mask };
  }
  if (masks.length > 1) {
    const { data, side } = masksToGih(masks.map((m) => m.mask), label, randomOrder, spacing * 100);
    const filename = pool.add('brushes', `${label}.gih`, data);
    const xml = `<Brush type="gbr_brush" filename=${xmlAttr(filename)} scale="${fmt(size / side)}" `
      + `spacing="${fmt(spacing)}" angle="${angle}" useAutoSpacing="0" autoSpacingCoeff="1" `
      + 'ColorAsMask="1" BrushVersion="2"/>';
    return { xml, files: [filename], mask: masks[0].mask };
  }
  const fade = fmt(Math.min(Math.max(hardness, 0.05), 1));
  const xml = `<Brush type="auto_brush" spacing="${fmt(spacing)}" angle="${angle}" randomness="0" density="1" `
    + 'useAutoSpacing="0" autoSpacingCoeff="1" BrushVersion="2"> <MaskGenerator '
    + `diameter="${fmt(size)}" ratio="1" hfade="${fade}" vfade="${fade}" spikes="2" `
    + 'antialiasEdges="1" type="circle" id="default"/> </Brush>';
  return { xml, files: [], mask: imaging.circleMask(hardness) };
}


/**
 * Texture settings for a texture the source applies to the stroke as a whole (Procreate
 * grain, CSP texture without "each tip"), where Krita can only texture each dab.
 *
 * Krita's Multiply mode loses such textures at tight spacing: the overlapping dabs build
 * the paint back up to solid. Subtract thins every dab in the same places, so the texture
 * survives, though more on/off than the source. Krita turns each pattern pixel g (0..1)
 * into v = clamp((g - brightness - 0.5) × contrast + 0.5), optionally inverted, and
 * subtracts it from every dab, which leaves v (or 1 - v) of a full dab. Measured in Krita
 * 5.3, the overlapping dabs build that up to about 1 - (1 - left)^N. N grows as spacing
 * shrinks but also depends on the brush: at 2% spacing it measured about 2 for a small
 * elliptical tip with size dynamics, and 15 for a plain round one. 0.6/√spacing sits
 * between, so coverage lands within roughly ±0.2 of the target. Brightness is solved so
 * the paint left on average matches what the source lets through.
 *
 * gray: the pattern as saved ({data: Uint8Array}, 0..255); through(g): share of the paint
 * the source keeps where the pattern is g (0..1), rising or falling; spacing: Krita spacing.
 */
export function strokeTexture(gray, through, spacing) {
  const hist = new Float64Array(256);
  for (const v of gray.data) hist[v]++;
  const n = gray.data.length || 1;
  const average = (f) => { let t = 0; for (let v = 0; v < 256; v++) if (hist[v]) t += f(v / 255) * hist[v] / n; return t; };
  const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
  const target = average((g) => clamp01(through(g)));
  const rising = through(1) >= through(0); // paint stays where the pattern is light
  const contrast = 2;
  const buildup = Math.min(Math.max(0.6 / Math.sqrt(Math.max(spacing, 0.01)), 1), 6);
  const left = (g, b) => { const v = clamp01((g - b - 0.5) * contrast + 0.5); return rising ? v : 1 - v; };
  const coverage = (b) => average((g) => 1 - (1 - left(g, b)) ** buildup);
  // Raising brightness darkens the pattern: less paint left if it stays on the light parts.
  const solve = (goal) => {
    let lo = -1, hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if ((coverage(mid) > goal) === rising) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // Patterns with few tones (a black/white check) hit the target over a whole range of
  // brightness; take its middle, away from the edges where one tone starts to flip.
  const brightness = (solve(target + 0.01) + solve(target - 0.01)) / 2;
  return { brightness, contrast, strength: 1, invert: rising, mode: 1 };
}

/** Krita's Texture option, for a pattern already added to the pool as `filename`. */
export function textureOption(params, { filename, png, width, height, scale, brightness = 0, contrast = 1,
  strength = 1, invert = false, mode = 0 }) {
  const digest = md5(png);
  const b64twice = (bytes) => btoa(base64(bytes));
  Object.assign(params, {
    'Texture/Pattern/Enabled': 'true',
    'Texture/Pattern/Name': filename,
    'Texture/Pattern/PatternFileName': filename,
    'Texture/Pattern/Pattern': ['bytearray', b64twice(png)],
    'Texture/Pattern/PatternMD5': ['bytearray', b64twice(digest)],
    'Texture/Pattern/PatternMD5Sum': hex(digest),
    'Texture/Pattern/Scale': fmt(scale),
    'Texture/Pattern/Brightness': fmt(brightness),
    'Texture/Pattern/Contrast': fmt(contrast),
    'Texture/Pattern/Strength': fmt(strength),
    'Texture/Pattern/Invert': invert ? 'true' : 'false',
    'Texture/Pattern/TexturingMode': String(mode),
    'Texture/Pattern/CutoffLeft': '0',
    'Texture/Pattern/CutoffRight': '255',
    'Texture/Pattern/CutoffPolicy': '0',
    'Texture/Pattern/MaximumOffsetX': String(width),
    'Texture/Pattern/MaximumOffsetY': String(height),
    'Texture/Pattern/OffsetX': '0',
    'Texture/Pattern/OffsetY': '0',
    'Texture/Pattern/isRandomOffsetX': 'false',
    'Texture/Pattern/isRandomOffsetY': 'false',
    'Texture/Strength/Sensor': sensorXml([]),
    'Texture/Strength/StrengthVersion': '2',
    'Texture/Strength/UseCurve': 'true',
    'Texture/Strength/UseSameCurve': 'false',
    'Texture/Strength/Value': '1',
    'Texture/Strength/curveMode': '0',
  });
}
