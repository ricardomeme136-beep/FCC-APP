// Shared "how long ago" formatter — used anywhere a timestamp needs to read
// as relative time (live map staleness, painel presence list, etc.) so the
// wording stays consistent across screens.
export function agoLabel(iso?: string | null): string {
  if (!iso) return "—";
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 5) return "agora";
  if (sec < 60) return `há ${sec}s`;
  if (sec < 3600) return `há ${Math.round(sec / 60)} min`;
  return `há ${Math.round(sec / 3600)}h`;
}
