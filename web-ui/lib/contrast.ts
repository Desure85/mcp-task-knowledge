/**
 * WCAG 2.1 colour maths for the theme system.
 *
 * `contrastRatio` is the single gate used by the CI test, the custom-theme
 * derivation and the editor's live table. Colours may arrive as hex (3, 4, 6
 * or 8 digits), `rgb()`/`rgba()` or `hsl()`/`hsla()`; alpha is parsed and
 * ignored because every theme token is an opaque CSS paint.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const HEX_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_RE =
  /^rgba?\(\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*(?:[,/]\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
const HSL_RE =
  /^hsla?\(\s*(-?\d+(?:\.\d+)?)(?:deg)?\s*[, ]\s*(-?\d+(?:\.\d+)?)%\s*[, ]\s*(-?\d+(?:\.\d+)?)%\s*(?:[,/]\s*(?:0|1|0?\.\d+)\s*)?\)$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(clamp(value, 0, 255));
}

function expandHex(hex: string): string {
  if (hex.length === 3) return hex.split('').map((c) => c + c).join('');
  if (hex.length === 4) return hex.slice(0, 3).split('').map((c) => c + c).join('');
  return hex.slice(0, 6);
}

/** Parse a CSS colour string into RGB; throws on anything else. */
export function parseColor(value: string): Rgb {
  if (typeof value !== 'string') throw new Error(`Not a colour: ${String(value)}`);
  const input = value.trim();
  const hex = HEX_RE.exec(input);
  if (hex) {
    const body = expandHex(hex[1]);
    return {
      r: parseInt(body.slice(0, 2), 16),
      g: parseInt(body.slice(2, 4), 16),
      b: parseInt(body.slice(4, 6), 16),
    };
  }
  const rgb = RGB_RE.exec(input);
  if (rgb) {
    const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) {
      throw new Error(`Colour channel out of range: ${input.slice(0, 32)}`);
    }
    return { r: round(channels[0]), g: round(channels[1]), b: round(channels[2]) };
  }
  const hsl = HSL_RE.exec(input);
  if (hsl) {
    const saturation = Number(hsl[2]);
    const lightness = Number(hsl[3]);
    if (!Number.isFinite(saturation) || !Number.isFinite(lightness) || saturation < 0 || saturation > 100 || lightness < 0 || lightness > 100) {
      throw new Error(`HSL out of range: ${input.slice(0, 32)}`);
    }
    const h = ((Number(hsl[1]) % 360) + 360) % 360;
    return hslToRgb({ h, s: saturation / 100, l: lightness / 100 });
  }
  throw new Error(`Not a colour: ${input.slice(0, 32)}`);
}

/** `#rrggbb` for any accepted colour. */
export function toHex(value: string | Rgb): string {
  const rgb = typeof value === 'string' ? parseColor(value) : value;
  const part = (n: number) => round(n).toString(16).padStart(2, '0');
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

/** Whether a string is an accepted colour (used by the theme validators). */
export function isColor(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 48) return false;
  try {
    parseColor(value);
    return true;
  } catch {
    return false;
  }
}

/** Backwards-compatible 6-digit hex parser used by earlier tests. */
export function parseHex(value: string): [number, number, number] {
  const rgb = parseColor(value);
  return [rgb.r, rgb.g, rgb.b];
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return { r: round((r1 + m) * 255), g: round((g1 + m) * 255), b: round((b1 + m) * 255) };
}

/** Linear mix in sRGB space; `weight` is the share of `to`. */
export function mix(from: string, to: string, weight: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  const w = clamp(weight, 0, 1);
  return toHex({
    r: a.r + (b.r - a.r) * w,
    g: a.g + (b.g - a.g) * w,
    b: a.b + (b.b - a.b) * w,
  });
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: string | Rgb): number {
  const rgb = typeof color === 'string' ? parseColor(color) : color;
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a >= b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}
