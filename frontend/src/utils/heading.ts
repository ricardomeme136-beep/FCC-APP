// Pure heading math — no React/React Native import, testable directly with
// Node's built-in test runner (see heading.test.ts). Used only for the
// driver's own on-screen marker in navegacao.tsx; never touches what gets
// sent to the backend (that stays GPS-only, via the background task).

export function normalizeHeading(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

// Signed shortest angular distance from `from` to `to`, in (-180, 180] —
// e.g. 359 -> 1 is +2 (not -358), 10 -> 350 is -20 (not +340).
export function angularDelta(from: number, to: number): number {
  const f = normalizeHeading(from);
  const t = normalizeHeading(to);
  const raw = t - f;
  return (((raw + 180) % 360) + 360) % 360 - 180;
}

// alpha in [0,1]: 1 snaps instantly to `next`, smaller values ease towards
// it over successive calls. Always takes the shorter arc. Tolerant of
// null/NaN in either argument (falls back to whichever side is usable).
export function smoothHeading(previous: number | null, next: number | null, alpha: number): number | null {
  const nextValid = next != null && Number.isFinite(next);
  const prevValid = previous != null && Number.isFinite(previous);
  if (!nextValid) return prevValid ? normalizeHeading(previous as number) : null;
  if (!prevValid) return normalizeHeading(next as number);
  return normalizeHeading((previous as number) + angularDelta(previous as number, next as number) * alpha);
}

export type HeadingSample = { trueHeading: number; magHeading: number; accuracy: number };

// Prefers true (geographic) north when the device reports it as usable;
// falls back to magnetic north; null if the compass isn't calibrated at all
// (accuracy 0 = "none", per expo-location's LocationHeadingObject).
export function pickCompassHeading(h: HeadingSample | null | undefined): number | null {
  if (!h) return null;
  if (!Number.isFinite(h.accuracy) || h.accuracy <= 0) return null;
  if (Number.isFinite(h.trueHeading) && h.trueHeading >= 0) return h.trueHeading;
  if (Number.isFinite(h.magHeading) && h.magHeading >= 0) return h.magHeading;
  return null;
}

// Below this speed, GPS course-over-ground is noise (or simply absent) —
// the compass is the only signal worth trusting while stationary.
export const STATIONARY_SPEED_MS = 2;

// SE parado/devagar: usa a bússola do dispositivo.
// SE em movimento: usa o GPS quando válido, com a bússola como reserva.
// Nunca devolve NaN/undefined — null só quando NENHUMA fonte é utilizável,
// e o chamador decide o que fazer nesse caso (ex.: esconder o cone de
// direção em vez de o desenhar apontado para um valor inventado).
export function fuseHeading(compassDeg: number | null, gpsDeg: number | null, speedMs: number | null): number | null {
  const gpsValid = gpsDeg != null && Number.isFinite(gpsDeg) && gpsDeg >= 0;
  const compassValid = compassDeg != null && Number.isFinite(compassDeg);
  const speed = speedMs ?? 0;

  if (speed < STATIONARY_SPEED_MS) {
    if (compassValid) return compassDeg as number;
    if (gpsValid) return gpsDeg as number;
    return null;
  }
  if (gpsValid) return gpsDeg as number;
  if (compassValid) return compassDeg as number;
  return null;
}
