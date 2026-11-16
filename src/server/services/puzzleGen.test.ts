import test from "node:test";
import assert from "node:assert/strict";
import { generateDailyPuzzle, issueNumberForDate } from "./puzzleGen.ts";

const catalog = [
  { name: "Indigo", hex: "#3F2B96", note: "Deep blue-violet." },
  { name: "Ochre", hex: "#CC7722", note: "Earth pigment." },
];
const friday = [
  { name: "Blue Hour", note: "A cool palette.", swatches: catalog },
];

test("daily puzzle generation is deterministic and has five rounds", () => {
  const first = generateDailyPuzzle("2026-11-13", "test-salt", catalog, friday);
  const second = generateDailyPuzzle("2026-11-13", "test-salt", catalog, friday);
  assert.deepEqual(first, second);
  assert.equal(first.rounds.length, 5);
  assert.equal(first.rounds[0].label, "Vibrant");
  assert.equal(first.rounds[4].label, "Friday theme");
  first.rounds.forEach((round, index) => {
    assert.equal(round.round, index + 1);
    assert.match(round.targetHex, /^#[0-9A-F]{6}$/);
  });
});

test("issue numbering matches the PRD sample date", () => {
  assert.equal(issueNumberForDate("2026-11-12"), 14);
  assert.equal(issueNumberForDate("2026-11-13"), 15);
});
