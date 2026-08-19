import { Platform, ViewStyle } from "react-native";

// WasteFlow — Modern Soft Light design system.
export const colors = {
  bg: "#F4F6F9",
  surface: "#FFFFFF",
  surfaceSecondary: "#F1F3F7",
  surfaceTertiary: "#E7EAF0",
  onSurface: "#111827",
  onSurfaceSecondary: "#374151",
  onSurfaceInverse: "#FFFFFF",
  surfaceInverse: "#111827",

  brand: "#F97316",
  onBrand: "#FFFFFF",
  brandSoft: "#FFF1E8",
  onBrandSoft: "#C2410C",

  // FCC Meio Ambiente institutional identity — additive tokens, confirmed by
  // pixel sampling the real logo (assets/images/fcc-logo.png) and the live
  // site's production CSS. Used starting with the admin painel redesign;
  // `brand` (orange) is untouched and keeps meaning "warning/attention" per
  // that redesign's own color rule, and stays the driver app's primary color.
  fccBlue: "#224A91",
  onFccBlue: "#FFFFFF",
  fccBlueSoft: "#E8EDF4",
  fccBlueLight: "#0074AD",
  fccGreen: "#1C8A44",
  onFccGreen: "#FFFFFF",
  fccGreenSoft: "#E3F3E9",

  success: "#16A34A",
  successSoft: "#DCFCE7",
  onSuccess: "#FFFFFF",
  warning: "#F59E0B",
  warningSoft: "#FEF3C7",
  onWarning: "#3A2A05",
  error: "#EF4444",
  errorSoft: "#FEE2E2",
  onError: "#FFFFFF",
  info: "#0EA5E9",
  infoSoft: "#E0F2FE",
  onInfo: "#FFFFFF",

  border: "#E6E8EE",
  borderStrong: "#E6E8EE",
  divider: "#EEF0F4",
  muted: "#6B7280",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  "2xl": 24,
  "3xl": 40,
};

export const radius = { xs: 6, sm: 10, md: 14, lg: 16, xl: 22, pill: 999 };

export const fonts = {
  display: "SpaceGrotesk-Bold",
  displayMedium: "SpaceGrotesk-SemiBold",
  mono: "SpaceGrotesk-Regular",
  monoMedium: "SpaceGrotesk-Medium",
  monoBold: "SpaceGrotesk-SemiBold",
};

// legacy shim (some screens still read border.width / border.color)
export const border = { width: 1, color: colors.border };

export const shadows: Record<string, ViewStyle> = {
  sm: Platform.select({
    ios: { shadowColor: "#0F172A", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
    android: { elevation: 1 },
    default: { boxShadow: "0 2px 8px rgba(15,23,42,0.05)" } as any,
  }) as ViewStyle,
  card: Platform.select({
    ios: { shadowColor: "#0F172A", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
    android: { elevation: 2 },
    default: { boxShadow: "0 3px 10px rgba(15,23,42,0.05), 0 1px 3px rgba(15,23,42,0.04)" } as any,
  }) as ViewStyle,
  // A touch stronger — floating panels, sheets, anything that should read as
  // sitting clearly above the page (modals, the map editor's side panel).
  float: Platform.select({
    ios: { shadowColor: "#0F172A", shadowOpacity: 0.12, shadowRadius: 28, shadowOffset: { width: 0, height: 12 } },
    android: { elevation: 6 },
    default: { boxShadow: "0 16px 40px rgba(15,23,42,0.12), 0 4px 10px rgba(15,23,42,0.06)" } as any,
  }) as ViewStyle,
};

// ---- Status maps (PT-PT) ----
export const vehicleStatus: Record<string, { label: string; color: string }> = {
  available: { label: "DISPONÍVEL", color: colors.success },
  assigned: { label: "ATRIBUÍDO", color: colors.info },
  en_route: { label: "EM ROTA", color: colors.brand },
  working: { label: "A TRABALHAR", color: colors.brand },
  stopped: { label: "PARADO", color: colors.warning },
  paused: { label: "EM PAUSA", color: colors.warning },
  maintenance: { label: "MANUTENÇÃO", color: colors.error },
  out_of_service: { label: "FORA DE SERVIÇO", color: colors.muted },
  offline: { label: "SEM LIGAÇÃO", color: colors.muted },
};

export const taskStatus: Record<string, { label: string; color: string }> = {
  scheduled: { label: "AGENDADA", color: colors.info },
  en_route: { label: "A CAMINHO", color: colors.brand },
  arrived: { label: "CHEGOU", color: colors.brand },
  collected: { label: "RECOLHIDA", color: colors.success },
  failed: { label: "FALHOU", color: colors.error },
  ignored: { label: "IGNORADA", color: colors.warning },
  cancelled: { label: "CANCELADA", color: colors.muted },
};

export const routeStatus: Record<string, { label: string; color: string }> = {
  draft: { label: "RASCUNHO", color: colors.muted },
  scheduled: { label: "AGENDADA", color: colors.info },
  assigned: { label: "ATRIBUÍDA", color: colors.info },
  in_progress: { label: "EM EXECUÇÃO", color: colors.brand },
  completed: { label: "CONCLUÍDA", color: colors.success },
  cancelled: { label: "CANCELADA", color: colors.error },
};

export const trackingSessionStatus: Record<string, { label: string; color: string }> = {
  recording: { label: "A GRAVAR", color: colors.error },
  completed: { label: "CONCLUÍDO", color: colors.success },
  cancelled: { label: "CANCELADO", color: colors.muted },
};

export const incidentStatus: Record<string, { label: string; color: string }> = {
  open: { label: "ABERTA", color: colors.error },
  assigned: { label: "ATRIBUÍDA", color: colors.warning },
  in_progress: { label: "EM TRATAMENTO", color: colors.brand },
  resolved: { label: "RESOLVIDA", color: colors.success },
  closed: { label: "FECHADA", color: colors.muted },
};

export const wasteColors: Record<string, string> = {
  general: "#64748B",
  paper: "#2563EB",
  plastic: "#F59E0B",
  glass: "#16A34A",
  organic: "#92400E",
  food: "#B45309",
  commercial: "#7C2D12",
  other: "#111827",
};

export const wasteLabels: Record<string, string> = {
  general: "Indiferenciados",
  paper: "Papel e cartão",
  plastic: "Plástico",
  glass: "Vidro",
  organic: "Orgânicos",
  food: "Alimentares",
  commercial: "Comerciais",
  other: "Outros",
};

// Real presence (Fase ACTIVITY 1) — derived from login/heartbeat/route
// status, never from employment_status (see incidentStatus-style maps
// above). "on_route" only applies while activity_status isn't "offline".
export const activityStatus: Record<string, { label: string; color: string; dot: string }> = {
  on_route: { label: "EM ROTA", color: colors.brand, dot: "🟢" },
  online: { label: "ONLINE", color: colors.success, dot: "🟢" },
  offline: { label: "OFFLINE", color: colors.muted, dot: "⚫" },
};

export const roleLabels: Record<string, string> = {
  super_admin: "Super Administrador",
  company_admin: "Administrador",
  dispatcher: "Despachante",
  driver: "Motorista",
  operations_manager: "Gestor de Operações",
  maintenance_manager: "Gestor de Manutenção",
  customer: "Cliente",
};

export const incidentKindLabels: Record<string, string> = {
  failed_collection: "Recolha falhada",
  container_full: "Contentor cheio",
  container_damaged: "Contentor danificado",
  container_missing: "Contentor desaparecido",
  access_blocked: "Acesso bloqueado",
  vehicle_breakdown: "Avaria de viatura",
  new_container: "Pedido de novo contentor",
  other: "Outro",
};
