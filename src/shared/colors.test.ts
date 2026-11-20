import test from "node:test";
import assert from "node:assert/strict";
import { colourAccuracy, deltaE2000, hexToLab, hslToHex, hslToRgb, labToHex } from "./colors.ts";

test("HSL primary values convert to expected sRGB hex", () => {
  assert.equal(hslToHex(0, 100, 50), "#FF0000");
  assert.equal(hslToHex(120, 100, 50), "#00FF00");
  assert.equal(hslToHex(240, 100, 50), "#0000FF");
  assert.deepEqual(hslToRgb(0, 100, 50), [1, 0, 0]);
  assert.deepEqual(hslToRgb(120, 100, 50), [0, 1, 0]);
  assert.deepEqual(hslToRgb(240, 100, 50), [0, 0, 1]);
});

test("CIEDE2000 is zero for identical colours", () => {
  assert.equal(deltaE2000(hexToLab("#1E4D8C"), hexToLab("#1E4D8C")), 0);
  assert.equal(colourAccuracy("#1E4D8C", "#1E4D8C").roundScore, 1000);
});

test("CIEDE2000 matches the published Sharma test pair", () => {
  const delta = deltaE2000(
    { L: 50, a: 2.6772, b: -79.7751 },
    { L: 50, a: 0, b: -82.7485 },
  );
  assert.ok(Math.abs(delta - 2.0425) < 0.0001);
});

test("Lab round-trip stays within a small sRGB quantisation tolerance", () => {
  const source = "#6B8E6E";
  const roundTrip = labToHex(hexToLab(source));
  const a = Number.parseInt(source.slice(1), 16);
  const b = Number.parseInt(roundTrip.slice(1), 16);
  const channelsA = [(a >> 16) & 255, (a >> 8) & 255, a & 255];
  const channelsB = [(b >> 16) & 255, (b >> 8) & 255, b & 255];
  channelsA.forEach((channel, i) => assert.ok(Math.abs(channel - channelsB[i]) <= 2));
});
