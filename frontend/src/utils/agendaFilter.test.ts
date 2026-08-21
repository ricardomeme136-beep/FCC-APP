// Run with: npm test (node --experimental-strip-types --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterAgendaItems } from "./agendaFilter.ts";

const items = [
  { id: "sched", status: "scheduled" },
  { id: "active", status: "in_progress" },
  { id: "done", status: "completed" },
  { id: "gone", status: "cancelled" },
];

test("default ATIVAS filter hides cancelled, keeps everything else", () => {
  const result = filterAgendaItems(items, "active");
  assert.deepEqual(result.map((i) => i.id).sort(), ["active", "done", "sched"]);
});

test("CANCELADAS filter shows only cancelled — a historical execution never appears in ATIVAS", () => {
  const result = filterAgendaItems(items, "cancelled");
  assert.deepEqual(result.map((i) => i.id), ["gone"]);
});

test("TODAS filter shows everything, cancelled included", () => {
  const result = filterAgendaItems(items, "all");
  assert.deepEqual(result.map((i) => i.id).sort(), ["active", "done", "gone", "sched"]);
});

test("a hard-deleted (never materialized) occurrence never appears in any filter — no item, nothing to filter", () => {
  // Nothing to assert against filterAgendaItems itself here — the point is
  // structural: a cancel-occurrence that hard-deleted the route means
  // GET /schedule/calendar never returns an item for that date in the
  // first place (see backend test_route_schedules.py), so there is no
  // "gone" entry for this scenario at all, in ANY filter.
  const noHistory: { id: string; status: string }[] = [];
  assert.deepEqual(filterAgendaItems(noHistory, "active"), []);
  assert.deepEqual(filterAgendaItems(noHistory, "cancelled"), []);
  assert.deepEqual(filterAgendaItems(noHistory, "all"), []);
});
