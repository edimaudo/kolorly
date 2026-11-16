import { createHash } from "node:crypto";
import { oklchToHex } from "../../shared/colors.ts";
import type { DailyPuzzle, PuzzleRound } from "../../shared/types";

export interface NamedSwatch {
  name: string;
  hex: string;
  note: string;
}

export interface FridayPalette {
  name: string;
  note: string;
  swatches: NamedSwatch[];
}

export const ISSUE_EPOCH_DATE = "2026-10-30";

export function issueNumberForDate(date: string): number {
  const start = Date.parse(`${ISSUE_EPOCH_DATE}T00:00:00.000Z`);
  const current = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(current) || current < start) return 1;
  return Math.floor((current - start) / 86_400_000) + 1;
}

export function createSeededRandom(date: string, salt: string): () => number {
  const seedHex = createHash("sha256").update(`${date}:${salt}`).digest("hex").slice(0, 8);
  let state = Number.parseInt(seedHex, 16) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const between = (rng: () => number, min: number, max: number): number => min + rng() * (max - min);
const randomHue = (rng: () => number): number => Math.floor(rng() * 360);

export function generateDailyPuzzle(
  date: string,
  salt: string,
  catalog: NamedSwatch[],
  fridayPalettes: FridayPalette[],
): DailyPuzzle {
  if (catalog.length === 0) throw new Error("The cultural colour catalogue is empty.");
  const rng = createSeededRandom(date, salt);
  const rounds: PuzzleRound[] = [];

  const h1 = randomHue(rng);
  const r1L = between(rng, 0.55, 0.68);
  const r1C = between(rng, 0.16, 0.24);
  rounds.push({ round: 1, label: "Vibrant", targetHex: oklchToHex(r1L, r1C, h1) });

  const h2 = (h1 + 70 + Math.floor(rng() * 220)) % 360;
  rounds.push({
    round: 2,
    label: "Pastel tint",
    targetHex: oklchToHex(between(rng, 0.82, 0.90), between(rng, 0.06, 0.12), h2),
  });

  const h3 = (h2 + 70 + Math.floor(rng() * 220)) % 360;
  rounds.push({
    round: 3,
    label: "Deep shade",
    targetHex: oklchToHex(between(rng, 0.22, 0.34), between(rng, 0.08, 0.16), h3),
  });

  rounds.push({
    round: 4,
    label: "Muted neutral",
    targetHex: oklchToHex(between(rng, 0.42, 0.68), between(rng, 0.015, 0.045), randomHue(rng)),
  });

  const utcDate = new Date(`${date}T00:00:00.000Z`);
  const isFriday = utcDate.getUTCDay() === 5;
  let cultural: NamedSwatch;
  let fridayTheme: string | undefined;
  if (isFriday && fridayPalettes.length > 0) {
    const palette = fridayPalettes[Math.floor(rng() * fridayPalettes.length)];
    cultural = palette.swatches[Math.floor(rng() * palette.swatches.length)] ?? catalog[Math.floor(rng() * catalog.length)];
    fridayTheme = palette.name;
    rounds.push({
      round: 5,
      label: "Friday theme",
      targetHex: cultural.hex,
      triviaTitle: `${cultural.name} · ${palette.name}`,
      triviaNote: `${cultural.note} ${palette.note}`,
    });
  } else {
    cultural = catalog[Math.floor(rng() * catalog.length)];
    rounds.push({
      round: 5,
      label: "Cultural colour",
      targetHex: cultural.hex,
      triviaTitle: cultural.name,
      triviaNote: cultural.note,
    });
  }

  return {
    date,
    issueNumber: issueNumberForDate(date),
    rounds,
    heroLightness: Math.round(r1L * 1000) / 10,
    ...(fridayTheme ? { fridayTheme } : {}),
  };
}
