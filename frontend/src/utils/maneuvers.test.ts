// Run with: node --experimental-strip-types --test src/utils/maneuvers.test.ts
// No test framework dependency — getManeuverPresentation is a pure function
// (no React/React Native), so Node's built-in runner is enough; adding
// jest-expo just for this would be a lot of new footprint for one module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getManeuverPresentation } from "./maneuvers.ts";

test("straight (type 6)", () => {
  const p = getManeuverPresentation({ type: 6, distance_m: 600, name: "Rua X" });
  assert.equal(p.title, "SIGA EM FRENTE");
  assert.equal(p.icon, "arrow-up");
  assert.equal(p.street, "Rua X");
});

test("depart (type 11) never shows a compass heading", () => {
  const p = getManeuverPresentation({ type: 11, text: "Head southwest", distance_m: 90, name: "Rua Y" });
  assert.equal(p.title, "SIGA EM FRENTE");
  assert.doesNotMatch(p.title, /sudoeste|southwest/i);
});

test("left (type 0)", () => {
  const p = getManeuverPresentation({ type: 0, distance_m: 90 });
  assert.equal(p.title, "VIRE À ESQUERDA");
  assert.equal(p.icon, "arrow-back");
});

test("right (type 1)", () => {
  const p = getManeuverPresentation({ type: 1, distance_m: 250, name: "Rua de Campelos" });
  assert.equal(p.title, "VIRE À DIREITA");
  assert.equal(p.icon, "arrow-forward");
  assert.equal(p.street, "Rua de Campelos");
});

test("slight left (type 4) / slight right (type 5)", () => {
  assert.equal(getManeuverPresentation({ type: 4 }).title, "LIGEIRA À ESQUERDA");
  assert.equal(getManeuverPresentation({ type: 5 }).title, "LIGEIRA À DIREITA");
});

test("sharp left (type 2) / sharp right (type 3)", () => {
  const left = getManeuverPresentation({ type: 2 });
  const right = getManeuverPresentation({ type: 3 });
  assert.equal(left.title, "CURVA ACENTUADA À ESQUERDA");
  assert.equal(left.icon, "return-up-back");
  assert.equal(right.title, "CURVA ACENTUADA À DIREITA");
  assert.equal(right.icon, "return-up-forward");
});

test("keep left (type 12) / keep right (type 13)", () => {
  assert.equal(getManeuverPresentation({ type: 12 }).title, "MANTENHA-SE À ESQUERDA");
  assert.equal(getManeuverPresentation({ type: 13 }).title, "MANTENHA-SE À DIREITA");
});

test("roundabout exit uses exit_number with a PT-PT ordinal", () => {
  const p1 = getManeuverPresentation({ type: 8, exit_number: 1, distance_m: 20 });
  const p2 = getManeuverPresentation({ type: 8, exit_number: 2, distance_m: 20 });
  assert.equal(p1.title, "NA ROTUNDA, SAIA NA 1.ª SAÍDA");
  assert.equal(p2.title, "NA ROTUNDA, SAIA NA 2.ª SAÍDA");
});

test("roundabout entry without exit_number yet falls back to a generic title", () => {
  const p = getManeuverPresentation({ type: 7, distance_m: 180 });
  assert.equal(p.title, "ENTRE NA ROTUNDA");
});

test("u-turn (type 9)", () => {
  const p = getManeuverPresentation({ type: 9 });
  assert.equal(p.title, "FAÇA INVERSÃO DE MARCHA");
  assert.equal(p.icon, "arrow-undo");
});

test("destination (type 10) sets isArrival", () => {
  const p = getManeuverPresentation({ type: 10, distance_m: 0 });
  assert.equal(p.title, "CHEGOU À PARAGEM");
  assert.equal(p.isArrival, true);
});

test("street name '-' or empty is treated as no street, not shown literally", () => {
  assert.equal(getManeuverPresentation({ type: 0, name: "-" }).street, null);
  assert.equal(getManeuverPresentation({ type: 0, name: "" }).street, null);
  assert.equal(getManeuverPresentation({ type: 0, name: "unnamed road" }).street, null);
  assert.equal(getManeuverPresentation({ type: 0, name: undefined }).street, null);
});

test("unknown/missing type falls back without inventing a compass heading", () => {
  const p = getManeuverPresentation({ type: 999, text: "Head northeast on Main St", distance_m: 10 });
  assert.equal(p.title, "SIGA EM FRENTE");
});

test("unknown type with a genuinely useful non-compass text keeps it", () => {
  const p = getManeuverPresentation({ type: undefined, text: "continue on the road" });
  assert.equal(p.title, "CONTINUE ON THE ROAD");
});

// The 5 real ORS steps captured during investigation (depot -> a real FCC
// container, ~5km), unmodified — a regression guard against this exact
// dataset, not just synthetic cases.
test("real captured ORS steps convert as expected", () => {
  const depart = getManeuverPresentation({
    type: 11, distance_m: 4273.4, name: "Rua da Serra de Campelos, EM 562",
    text: "Siga para sudeste em direção a Rua da Serra de Campelos, EM 562",
  });
  assert.equal(depart.title, "SIGA EM FRENTE");
  assert.equal(depart.street, "Rua da Serra de Campelos, EM 562");

  const right = getManeuverPresentation({ type: 1, distance_m: 84.1, name: "EM 207-1", text: "Vire à direita em direção a EM 207-1" });
  assert.equal(right.title, "VIRE À DIREITA");

  const left = getManeuverPresentation({ type: 0, distance_m: 192.1, name: "-", text: "Vire à esquerda" });
  assert.equal(left.title, "VIRE À ESQUERDA");
  assert.equal(left.street, null);

  // type says "keep right" even though ORS's own text says "vire à
  // direita" — type wins, by design (see the module header comment).
  const keepRight = getManeuverPresentation({ type: 13, distance_m: 312.0, name: "-", text: "Vire à direita" });
  assert.equal(keepRight.title, "MANTENHA-SE À DIREITA");

  const arrive = getManeuverPresentation({ type: 10, distance_m: 0, text: "Chegar a Travessa de Samarim, à esquerda" });
  assert.equal(arrive.title, "CHEGOU À PARAGEM");
  assert.equal(arrive.isArrival, true);
});
