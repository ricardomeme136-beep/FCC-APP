// Turn-by-turn presentation — pure function, no React/React Native import,
// so it's testable with a plain Node test runner (see maneuvers.test.ts).
//
// ORS's numeric step `type` is a stable, documented, language-independent
// instruction sign (openrouteservice API docs / the GraphHopper convention
// it inherits) — used as the source of truth instead of the free-text
// `instruction` string. The text is often fine, but for a "depart" step in
// particular it renders as an unhelpful compass heading ("Siga para
// sudoeste em direção a ..."), which is exactly what this replaces.
// backend/services/routing.py passes `type`/`exit_number` through verbatim;
// nothing here talks to ORS or changes routing/geometry.

export type OrsStep = {
  text?: string;
  distance_m?: number | null;
  duration_s?: number | null;
  name?: string | null;
  type?: number | null;
  exit_number?: number | null;
};

export type ManeuverIcon =
  | "arrow-up" | "arrow-back" | "arrow-forward"
  | "return-up-back" | "return-up-forward"
  | "chevron-back-outline" | "chevron-forward-outline"
  | "sync-circle-outline" | "sync-circle"
  | "arrow-undo" | "flag" | "navigate";

export type ManeuverPresentation = {
  icon: ManeuverIcon;
  title: string;        // e.g. "VIRE À DIREITA" — always PT-PT, never a raw ORS string, never a compass heading
  street: string | null; // null when ORS gives nothing usable ("-", "", "unnamed road", missing)
  distanceM: number;     // this step's own total length (NOT "remaining to maneuver" — the caller tracks that live)
  isArrival: boolean;
};

const ORS_TYPE: Record<number, { icon: ManeuverIcon; title: string }> = {
  0: { icon: "arrow-back", title: "VIRE À ESQUERDA" },
  1: { icon: "arrow-forward", title: "VIRE À DIREITA" },
  2: { icon: "return-up-back", title: "CURVA ACENTUADA À ESQUERDA" },
  3: { icon: "return-up-forward", title: "CURVA ACENTUADA À DIREITA" },
  4: { icon: "arrow-back", title: "LIGEIRA À ESQUERDA" },
  5: { icon: "arrow-forward", title: "LIGEIRA À DIREITA" },
  6: { icon: "arrow-up", title: "SIGA EM FRENTE" },
  7: { icon: "sync-circle-outline", title: "ENTRE NA ROTUNDA" },
  8: { icon: "sync-circle", title: "SAIA DA ROTUNDA" }, // refined below when exit_number is known
  9: { icon: "arrow-undo", title: "FAÇA INVERSÃO DE MARCHA" },
  10: { icon: "flag", title: "CHEGOU À PARAGEM" },
  11: { icon: "arrow-up", title: "SIGA EM FRENTE" }, // "depart" — never a compass heading
  12: { icon: "chevron-back-outline", title: "MANTENHA-SE À ESQUERDA" },
  13: { icon: "chevron-forward-outline", title: "MANTENHA-SE À DIREITA" },
};

const ORDINALS_PT = ["1.ª", "2.ª", "3.ª", "4.ª", "5.ª", "6.ª", "7.ª", "8.ª"];

function ordinalPt(n: number): string {
  return ORDINALS_PT[n - 1] || `${n}.ª`;
}

function cleanStreetName(name?: string | null): string | null {
  if (!name) return null;
  const n = name.trim();
  if (!n || n === "-" || n.toLowerCase() === "unnamed road") return null;
  return n;
}

// PT-PT first (the app always requests language:"pt" from ORS — see
// services/routing.py), English kept as a defensive fallback in case a step
// ever arrives untranslated.
const COMPASS_WORDS = /\b(norte|sul|este|oeste|nordeste|noroeste|sudeste|sudoeste|north|south|east|west|northeast|northwest|southeast|southwest)\b/i;

export function getManeuverPresentation(step: OrsStep): ManeuverPresentation {
  const distanceM = Math.max(0, step.distance_m ?? 0);
  const street = cleanStreetName(step.name);

  const known = step.type != null ? ORS_TYPE[step.type] : undefined;
  if (known) {
    let title = known.title;
    if (step.type === 8 && step.exit_number) {
      title = `NA ROTUNDA, SAIA NA ${ordinalPt(step.exit_number)} SAÍDA`;
    } else if (step.type === 7 && step.exit_number) {
      title = `ROTUNDA · ${ordinalPt(step.exit_number)} SAÍDA`;
    }
    return { icon: known.icon, title, street, distanceM, isArrival: step.type === 10 };
  }

  // Fallback for a missing/unrecognized type (e.g. a future ORS code this
  // table doesn't have yet) — never surface a raw compass-heading string.
  const text = (step.text || "").trim();
  const title = (!text || COMPASS_WORDS.test(text)) ? "SIGA EM FRENTE" : text.toUpperCase();
  return { icon: "navigate", title, street, distanceM, isArrival: false };
}
