// Run with: npm test (node --experimental-strip-types --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHeading, angularDelta, smoothHeading, pickCompassHeading, fuseHeading } from "./heading.ts";

test("normalizeHeading wraps into [0, 360)", () => {
  assert.equal(normalizeHeading(0), 0);
  assert.equal(normalizeHeading(359), 359);
  assert.equal(normalizeHeading(360), 0);
  assert.equal(normalizeHeading(370), 10);
  assert.equal(normalizeHeading(-10), 350);
  assert.equal(normalizeHeading(-370), 350);
  assert.equal(normalizeHeading(NaN), 0);
});

test("angularDelta always takes the shorter arc", () => {
  assert.equal(angularDelta(10, 20), 10);
  assert.equal(angularDelta(350, 10), 20);   // forward through 0, not -340
  assert.equal(angularDelta(10, 350), -20);  // backward through 0, not +340
  assert.equal(angularDelta(359, 1), 2);     // not -358
  assert.equal(angularDelta(1, 359), -2);
  assert.equal(angularDelta(180, 180), 0);
  assert.equal(Math.abs(angularDelta(0, 180)), 180); // exact opposite (180°) — direction is ambiguous by definition, magnitude isn't
});

test("smoothHeading — the 7 required cases", () => {
  assert.equal(smoothHeading(10, 20, 1), 20);
  assert.equal(smoothHeading(350, 10, 1), 10);      // via +20 arc, lands exactly on 10
  assert.equal(smoothHeading(10, 350, 1), 350);     // via -20 arc, lands exactly on 350
  assert.equal(smoothHeading(359, 1, 1), 1);
  assert.equal(smoothHeading(-10, 20, 1), 20);      // negative input, normalized first
  assert.equal(smoothHeading(370, 10, 1), 10);      // >360 input, normalized first
  assert.equal(smoothHeading(100, NaN, 0.5), 100);  // invalid `next` — keeps previous
  assert.equal(smoothHeading(null, 45, 0.5), 45);   // invalid `previous` — snaps to next
  assert.equal(smoothHeading(null, null, 0.5), null); // both invalid — no opinion
});

test("smoothHeading partial alpha eases along the shorter arc, never overshoots", () => {
  const half = smoothHeading(0, 100, 0.5);
  assert.equal(half, 50);
  const halfWrap = smoothHeading(350, 30, 0.5); // shorter arc is +40 (350->360/0->30)
  assert.equal(halfWrap, 10); // 350 + 20 = 370 -> normalized 10
});

test("pickCompassHeading prefers trueHeading, falls back to magHeading, rejects uncalibrated", () => {
  assert.equal(pickCompassHeading({ trueHeading: 90, magHeading: 88, accuracy: 3 }), 90);
  assert.equal(pickCompassHeading({ trueHeading: -1, magHeading: 88, accuracy: 3 }), 88);
  assert.equal(pickCompassHeading({ trueHeading: 90, magHeading: 88, accuracy: 0 }), null); // "none" calibration
  assert.equal(pickCompassHeading(null), null);
});

test("fuseHeading: stationary prefers compass", () => {
  assert.equal(fuseHeading(45, 200, 0), 45);
  assert.equal(fuseHeading(45, 200, 1), 45); // below STATIONARY_SPEED_MS (2)
  assert.equal(fuseHeading(null, 200, 0), 200); // no compass while stationary — GPS is better than nothing
});

test("fuseHeading: moving prefers GPS, falls back to compass", () => {
  assert.equal(fuseHeading(45, 200, 5), 200);
  assert.equal(fuseHeading(45, -1, 5), 45); // GPS heading invalid (-1) while moving — use compass
  assert.equal(fuseHeading(null, null, 5), null);
});
