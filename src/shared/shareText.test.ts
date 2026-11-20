import test from "node:test";
import assert from "node:assert/strict";
import { formatShareText } from "./shareText.ts";
import type { RoundResult } from "./types.ts";

const rounds: RoundResult[] = [
  { round: 1, targetHex: "#D85D4A", guessHex: "#C85A4B", deltaE: 8.4, accuracyPct: 45, roundScore: 450, crowdAvgHex: "#B85D50", crowdAccuracyPct: 50, crowdCount: 12 },
  { round: 2, targetHex: "#E8D5BC", guessHex: "#D7C6B2", deltaE: 28.6, accuracyPct: 37, roundScore: 370, crowdAvgHex: "#808080", crowdAccuracyPct: 0, crowdCount: 0 },
];

test("share text includes the exact target, player and crowd colours for each swatch", () => {
  const text = formatShareText({ issueNumber: 22, totalScore: 820, rounds, streak: 0, isArchive: true });
  assert.match(text, /Kolorly #022 — 820\/5,000 \(16\.4%\)/);
  assert.match(text, /1\. Target #D85D4A · Your mix #C85A4B · Community #B85D50 \(12 guesses\) · 45\.0% · 450 pts/);
  assert.match(text, /2\. Target #E8D5BC · Your mix #D7C6B2 · 37\.0% · 370 pts/);
  assert.doesNotMatch(text, /🟥|🟨|🟩|Practice run/);
});

test("share text includes a genuine streak but never labels a practice run", () => {
  const text = formatShareText({ issueNumber: 23, totalScore: 0, rounds: [], streak: 6, isArchive: false });
  assert.match(text, /Streak: 6 days/);
  assert.doesNotMatch(text, /Practice run/);
});
