export interface LabColor {
  L: number;
  a: number;
  b: number;
}

export interface HslColor {
  h: number;
  s: number;
  l: number;
}

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));
const roundByte = (value: number): number => Math.round(clamp(value) * 255);
const channelToHex = (value: number): string => roundByte(value).toString(16).padStart(2, "0").toUpperCase();

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s / 100);
  const light = clamp(l / 100);
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - chroma / 2;
  let rgb: [number, number, number];

  if (hue < 60) rgb = [chroma, x, 0];
  else if (hue < 120) rgb = [x, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, x];
  else if (hue < 240) rgb = [0, x, chroma];
  else if (hue < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];

  return rgbToHex(rgb[0] + m, rgb[1] + m, rgb[2] + m);
}

export function hexToRgb(hex: string): [number, number, number] {
  const normalised = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalised)) {
    throw new Error(`Invalid six-digit hex colour: ${hex}`);
  }
  return [0, 2, 4].map((offset) => parseInt(normalised.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.max(0, channel) ** (1 / 2.4) - 0.055;
}

export function hexToLab(hex: string): LabColor {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = srgbToLinear(r8);
  const g = srgbToLinear(g8);
  const b = srgbToLinear(b8);

  // Convert sRGB (D65) to XYZ, Bradford-adapt to D50, then calculate Lab.
  // CIEDE2000 reference implementations conventionally use D50 Lab for sRGB.
  const x65 = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y65 = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z65 = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const x = (1.0478112 * x65 + 0.0228866 * y65 - 0.0501270 * z65) / 0.96422;
  const y = (0.0295424 * x65 + 0.9904844 * y65 - 0.0170491 * z65) / 1.0;
  const z = (-0.0092345 * x65 + 0.0150436 * y65 + 0.7521316 * z65) / 0.82521;
  const f = (value: number): number => value > 0.008856451679 ? Math.cbrt(value) : 7.787037037 * value + 16 / 116;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToHex(lab: LabColor): string {
  const fy = (lab.L + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const fInv = (value: number): number => {
    const cube = value ** 3;
    return cube > 0.008856451679 ? cube : (value - 16 / 116) / 7.787037037;
  };
  const x50 = 0.96422 * fInv(fx);
  const y50 = fInv(fy);
  const z50 = 0.82521 * fInv(fz);
  // Inverse Bradford adaptation: D50 XYZ back to the sRGB D65 white point.
  const x = 0.9555766 * x50 - 0.0230393 * y50 + 0.0631636 * z50;
  const y = -0.0282895 * x50 + 1.0099416 * y50 + 0.0210077 * z50;
  const z = 0.0122982 * x50 - 0.0204830 * y50 + 1.3299098 * z50;
  const r = linearToSrgb(3.2404542 * x - 1.5371385 * y - 0.4985314 * z);
  const g = linearToSrgb(-0.969266 * x + 1.8760108 * y + 0.041556 * z);
  const b = linearToSrgb(0.0556434 * x - 0.2040259 * y + 1.0572252 * z);
  return rgbToHex(r, g, b);
}

export function deltaE2000(first: LabColor, second: LabColor): number {
  const rad = Math.PI / 180;
  const c1 = Math.hypot(first.a, first.b);
  const c2 = Math.hypot(second.a, second.b);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const a1Prime = (1 + g) * first.a;
  const a2Prime = (1 + g) * second.a;
  const c1Prime = Math.hypot(a1Prime, first.b);
  const c2Prime = Math.hypot(a2Prime, second.b);
  const h1Prime = (Math.atan2(first.b, a1Prime) / rad + 360) % 360;
  const h2Prime = (Math.atan2(second.b, a2Prime) / rad + 360) % 360;

  const deltaLPrime = second.L - first.L;
  const deltaCPrime = c2Prime - c1Prime;
  let deltaHAngle = 0;
  if (c1Prime * c2Prime !== 0) {
    const difference = h2Prime - h1Prime;
    if (Math.abs(difference) <= 180) deltaHAngle = difference;
    else if (difference > 180) deltaHAngle = difference - 360;
    else deltaHAngle = difference + 360;
  }
  const deltaHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin((deltaHAngle / 2) * rad);

  const lBar = (first.L + second.L) / 2;
  const cPrimeBar = (c1Prime + c2Prime) / 2;
  let hPrimeBar: number;
  if (c1Prime * c2Prime === 0) hPrimeBar = h1Prime + h2Prime;
  else if (Math.abs(h1Prime - h2Prime) <= 180) hPrimeBar = (h1Prime + h2Prime) / 2;
  else if (h1Prime + h2Prime < 360) hPrimeBar = (h1Prime + h2Prime + 360) / 2;
  else hPrimeBar = (h1Prime + h2Prime - 360) / 2;

  const t = 1
    - 0.17 * Math.cos((hPrimeBar - 30) * rad)
    + 0.24 * Math.cos(2 * hPrimeBar * rad)
    + 0.32 * Math.cos((3 * hPrimeBar + 6) * rad)
    - 0.20 * Math.cos((4 * hPrimeBar - 63) * rad);
  const deltaTheta = 30 * Math.exp(-(((hPrimeBar - 275) / 25) ** 2));
  const cPrimeBar7 = cPrimeBar ** 7;
  const rc = 2 * Math.sqrt(cPrimeBar7 / (cPrimeBar7 + 25 ** 7));
  const lTerm = lBar - 50;
  const sl = 1 + (0.015 * lTerm ** 2) / Math.sqrt(20 + lTerm ** 2);
  const sc = 1 + 0.045 * cPrimeBar;
  const sh = 1 + 0.015 * cPrimeBar * t;
  const rt = -Math.sin(2 * deltaTheta * rad) * rc;
  const l = deltaLPrime / sl;
  const c = deltaCPrime / sc;
  const h = deltaHPrime / sh;
  return Math.sqrt(Math.max(0, l * l + c * c + h * h + rt * c * h));
}

export function colourAccuracy(targetHex: string, guessHex: string): { deltaE: number; accuracyPct: number; roundScore: number } {
  const deltaE = deltaE2000(hexToLab(targetHex), hexToLab(guessHex));
  const accuracyPct = Number(Math.max(0, Math.min(100, 100 - deltaE * 2.2)).toFixed(1));
  return { deltaE: Number(deltaE.toFixed(2)), accuracyPct, roundScore: Math.round(accuracyPct * 10) };
}

export function averageLab(aggregate: { sumL: number; sumA: number; sumB: number; count: number }): LabColor | null {
  if (aggregate.count <= 0) return null;
  return {
    L: aggregate.sumL / aggregate.count,
    a: aggregate.sumA / aggregate.count,
    b: aggregate.sumB / aggregate.count,
  };
}

export function oklchToHex(lightness: number, chroma: number, hueDegrees: number): string {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  const toLinearRgb = (c: number): [number, number, number] => {
    const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  };

  const inGamut = (rgb: number[]): boolean => rgb.every((channel) => channel >= -1e-7 && channel <= 1.0000001);
  let chosen = toLinearRgb(chroma);
  if (!inGamut(chosen)) {
    let low = 0;
    let high = chroma;
    for (let i = 0; i < 24; i += 1) {
      const mid = (low + high) / 2;
      const candidate = toLinearRgb(mid);
      if (inGamut(candidate)) {
        low = mid;
        chosen = candidate;
      } else {
        high = mid;
      }
    }
  }
  return rgbToHex(linearToSrgb(chosen[0]), linearToSrgb(chosen[1]), linearToSrgb(chosen[2]));
}
