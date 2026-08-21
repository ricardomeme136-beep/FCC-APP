// Agenda status filter (point 1/2/3/5) — a cancelled execution is
// deliberately preserved in the backend when it has real history (the
// generic DELETE /routes/{id} archive path, or a future equivalent), but
// the day-to-day operational Agenda should not keep showing it once it no
// longer needs any action. Pure so the exact scenarios from the spec are
// directly testable without a running app.
export type AgendaStatusFilter = "active" | "cancelled" | "all";

export function filterAgendaItems<T extends { status: string }>(
  items: T[], filter: AgendaStatusFilter
): T[] {
  if (filter === "all") return items;
  if (filter === "cancelled") return items.filter((it) => it.status === "cancelled");
  return items.filter((it) => it.status !== "cancelled");
}
