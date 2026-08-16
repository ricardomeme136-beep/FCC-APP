import { Platform } from "react-native";

// WasteFlow — Brutalist Mobile LIGHT design system.
export const colors = {
  surface: "#FFFFFF",
  onSurface: "#0A0A0A",
  surfaceSecondary: "#F4F4F5",
  onSurfaceSecondary: "#18181B",
  surfaceTertiary: "#E4E4E7",
  onSurfaceTertiary: "#27272A",
  surfaceInverse: "#0A0A0A",
  onSurfaceInverse: "#FFFFFF",
  brand: "#F97316",
  onBrand: "#0A0A0A",
  brandTertiary: "#FFEDD5",
  onBrandTertiary: "#C2410C",
  success: "#059669",
  onSuccess: "#FFFFFF",
  warning: "#F59E0B",
  onWarning: "#0A0A0A",
  error: "#DC2626",
  onError: "#FFFFFF",
  info: "#3F3F46",
  onInfo: "#FFFFFF",
  border: "#E4E4E7",
  borderStrong: "#0A0A0A",
  divider: "#E4E4E7",
  muted: "#71717A",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
};

export const radius = { sm: 0, md: 0, lg: 0, pill: 0 };

export const fonts = {
  display: "SpaceGrotesk-Bold",
  displayMedium: "SpaceGrotesk-Medium",
  mono: "Mono",
  monoMedium: "Mono-Medium",
  monoBold: "Mono-Bold",
};

export const border = {
  width: 2,
  color: colors.borderStrong,
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

export const incidentStatus: Record<string, { label: string; color: string }> = {
  open: { label: "ABERTA", color: colors.error },
  assigned: { label: "ATRIBUÍDA", color: colors.warning },
  in_progress: { label: "EM TRATAMENTO", color: colors.brand },
  resolved: { label: "RESOLVIDA", color: colors.success },
  closed: { label: "FECHADA", color: colors.muted },
};

export const wasteColors: Record<string, string> = {
  general: "#3F3F46",
  paper: "#2563EB",
  plastic: "#F59E0B",
  glass: "#059669",
  organic: "#92400E",
  food: "#B45309",
  commercial: "#7C2D12",
  other: "#0A0A0A",
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

export const monoFamily = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
