import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { filterAgendaItems, AgendaStatusFilter } from "@/src/utils/agendaFilter";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Card, Empty, Loading, SearchInput, Txt, useToast } from "@/src/components/ui";
import ContainerPicker from "@/src/components/ContainerPicker";
import { colors, spacing, border, radius, routeStatus, wasteLabels, vehicleStatus } from "@/src/theme";

const STATUS_FILTERS: { key: AgendaStatusFilter; label: string }[] = [
  { key: "active", label: "ATIVAS" },
  { key: "cancelled", label: "CANCELADAS" },
  { key: "all", label: "TODAS" },
];

type Vehicle = { id: string; plate: string; capacity_kg: number; allowed_waste_types: string[]; status: string };
type Driver = { id: string; name: string; status: string };
type Place = { id: string; name: string; is_primary?: boolean };

function nextDays(n: number) {
  const out: { date: string; label: string }[] = [];
  const base = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const label = i === 0 ? "HOJE" : i === 1 ? "AMANHÃ" : d.toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit" }).toUpperCase();
    out.push({ date: iso, label });
  }
  return out;
}
const DATE_OPTIONS = nextDays(14);

export default function Execucoes() {
  const router = useRouter();
  const toast = useToast();
  const [routes, setRoutes] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  // Default "active" hides archived/cancelled executions — a route with
  // real history is never hard-deleted by DELETE /routes/{id} (it's
  // archived, status -> cancelled, to keep proof of the work) but this
  // list showed every status unfiltered, so an "eliminar" that archived a
  // route left the card sitting right here, indistinguishable at a glance
  // from an active one — reading as "eliminar não funcionou".
  const [statusFilter, setStatusFilter] = useState<AgendaStatusFilter>("active");

  const [date, setDate] = useState(DATE_OPTIONS[0].date);
  const [containerIds, setContainerIds] = useState<string[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [depots, setDepots] = useState<Place[]>([]);
  const [facilities, setFacilities] = useState<Place[]>([]);
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [driverIds, setDriverIds] = useState<string[]>([]);
  const [depotId, setDepotId] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [numTrucks, setNumTrucks] = useState(4);
  const [optimizing, setOptimizing] = useState(false);

  const [preview, setPreview] = useState<{ routes: any[]; skipped: string[] } | null>(null);

  const load = useCallback(async () => {
    const r = await api.get<any[]>("/routes");
    setRoutes(r);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    (async () => {
      const [v, d, dep, fac, tpl] = await Promise.all([
        api.get<Vehicle[]>("/vehicles"),
        api.get<Driver[]>("/drivers"),
        api.get<Place[]>("/depots"),
        api.get<Place[]>("/facilities"),
        api.get<any[]>("/route-templates"),
      ]);
      setVehicles(v.filter((x) => x.status === "available" || x.status === "assigned"));
      setDrivers(d.filter((x: any) => x.status === "available" || x.status === "assigned"));
      setDepots(dep);
      setFacilities(fac);
      setTemplates(tpl);
      // Show the primary depot pre-selected instead of leaving it on the
      // implicit "AUTOMÁTICO" default — the admin sees exactly which depot
      // will be used before generating anything.
      const primary = dep.find((d2) => d2.is_primary);
      if (primary) setDepotId(primary.id);
    })();
  }, []);

  const generate = async () => {
    if (containerIds.length === 0) {
      toast("Selecione pelo menos um contentor", "error");
      return;
    }
    setOptimizing(true);
    setCreating(true);
    try {
      const body: any = { date, container_ids: containerIds };
      if (vehicleIds.length) body.vehicle_ids = vehicleIds;
      else body.num_trucks = numTrucks;
      if (driverIds.length) body.driver_ids = driverIds;
      if (depotId) body.depot_id = depotId;
      if (facilityId) body.facility_id = facilityId;

      const res = await api.post<{ routes: any[]; count: number; skipped_duplicate: string[] }>("/routes/optimize", body);
      setPreview({ routes: res.routes, skipped: res.skipped_duplicate || [] });
      toast(`${res.count} rota(s) gerada(s)`, "success");
      await load();
    } catch (e: any) {
      toast(e?.message || "Falha na otimização", "error");
    } finally {
      setOptimizing(false);
    }
  };

  const discardPreviewRoute = async (rid: string) => {
    try {
      await api.del(`/routes/${rid}`);
      setPreview((p) => (p ? { ...p, routes: p.routes.filter((r) => r.id !== rid) } : p));
      toast("Rota descartada", "success");
      await load();
    } catch (e: any) {
      toast(e?.message || "Erro", "error");
    }
  };

  const finishPreview = () => {
    setPreview(null);
    setCreating(false);
    setContainerIds([]);
    setVehicleIds([]);
    setDriverIds([]);
  };

  const templateById = useMemo(() => Object.fromEntries(templates.map((t) => [t.id, t])), [templates]);

  const vehicleLabel = (v: Vehicle) =>
    `${v.plate} · ${v.capacity_kg}kg${v.allowed_waste_types?.length ? " · " + v.allowed_waste_types.map((w) => wasteLabels[w] || w).join("/") : ""}`;

  if (!routes) {
    return (<View style={styles.flex}><ScreenHeader title="EXECUÇÕES" subtitle="ROTAS DO DIA" /><Loading /></View>);
  }

  if (preview) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="EXECUÇÕES GERADAS" subtitle="PRÉ-VISUALIZAÇÃO" />
        <ScrollView contentContainerStyle={styles.scroll}>
          {preview.skipped.length > 0 && (
            <Card style={{ backgroundColor: "#FFFBEB", gap: 4 }}>
              <Txt variant="monoBold" color={colors.warning}>{preview.skipped.length} contentor(es) ignorados</Txt>
              <Txt variant="mono" color={colors.muted}>Já tinham recolhas agendadas para esta data.</Txt>
            </Card>
          )}
          {preview.routes.length === 0 ? (
            <Empty text="Nenhuma rota criada." icon="navigate-outline" />
          ) : (
            preview.routes.map((r) => {
              const v = vehicles.find((x) => x.id === r.vehicle_id);
              return (
                <Card key={r.id} style={{ gap: spacing.sm }}>
                  <View style={styles.routeHead}>
                    <Txt variant="displaySm" color={colors.brand}>{r.code}</Txt>
                    <Pressable testID={`discard-${r.id}`} onPress={() => discardPreviewRoute(r.id)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={20} color={colors.error} />
                    </Pressable>
                  </View>
                  <Txt variant="mono" color={colors.muted}>
                    {r.driver_name || "Sem motorista"} · {v?.plate || "—"}
                  </Txt>
                  <View style={styles.routeStats}>
                    <Stat label="PARAGENS" value={r.num_stops} />
                    <Stat label="DISTÂNCIA" value={`${r.distance_km} km`} />
                    <Stat label="DURAÇÃO" value={`${Math.round(r.duration_min / 60)}h${Math.round(r.duration_min % 60)}`} />
                  </View>
                  <Pressable testID={`open-${r.id}`} onPress={() => router.push(`/route/${r.id}` as any)}>
                    <Txt variant="monoBold" color={colors.brand}>VER DETALHE →</Txt>
                  </Pressable>
                </Card>
              );
            })
          )}
          <Btn testID="finish-preview" title="CONCLUIR" variant="dark" onPress={finishPreview} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="EXECUÇÕES" subtitle="ROTAS DO DIA" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {!creating ? (
          <>
            <View style={styles.createRow}>
              <Btn testID="start-create-route" title="CRIAR AUTOMATICAMENTE" icon="git-network" size="sm" style={{ flex: 1 }} onPress={() => setCreating(true)} />
              <Btn testID="start-create-route-map" title="CRIAR NO MAPA" icon="map" variant="outline" size="sm" style={{ flex: 1 }} onPress={() => router.push("/(manager)/mapa-rota" as any)} />
            </View>
            {routes.length > 0 && (
              <>
                <SearchInput testID="search-routes" value={search} onChangeText={setSearch} placeholder="Pesquisar por código ou motorista..." />
                <View style={styles.statusFilterRow}>
                  {STATUS_FILTERS.map((f) => {
                    const on = statusFilter === f.key;
                    return (
                      <Pressable key={f.key} testID={`execucoes-status-filter-${f.key}`} onPress={() => setStatusFilter(f.key)}
                                style={[styles.chip, on ? styles.chipOn : null]}>
                        <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{f.label}</Txt>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
            {routes.length === 0 ? (
              <Empty text="Nenhuma rota criada." icon="navigate-outline" />
            ) : (
              filterAgendaItems(routes, statusFilter)
                .filter((r) => !search || r.code?.toLowerCase().includes(search.toLowerCase()) || r.driver_name?.toLowerCase().includes(search.toLowerCase()))
                .map((r) => {
                const st = routeStatus[r.status] || routeStatus.scheduled;
                const tpl = r.template_id ? templateById[r.template_id] : null;
                const vehiclePlate = vehicles.find((v) => v.id === r.vehicle_id)?.plate;
                return (
                  <Pressable key={r.id} testID={`route-${r.id}`} onPress={() => router.push(`/route/${r.id}` as any)}>
                    <View style={styles.routeCard}>
                      <View style={styles.routeHead}>
                        <Txt variant="displaySm">{r.code}</Txt>
                        <View style={[styles.stTag, { backgroundColor: st.color }]}>
                          <Txt variant="monoBold" color="#fff" style={{ fontSize: 10 }}>{st.label}</Txt>
                        </View>
                      </View>
                      {tpl && (
                        <View style={styles.templateTag}>
                          <Ionicons name="git-network" size={11} color={colors.fccBlue} />
                          <Txt variant="label" color={colors.fccBlue} numberOfLines={1}>{tpl.name}</Txt>
                        </View>
                      )}
                      <Txt variant="mono" color={colors.muted}>
                        {r.date}{r.planned_start_time ? ` · ${r.planned_start_time}` : ""} · {r.driver_name || "Sem motorista"}{vehiclePlate ? ` · ${vehiclePlate}` : ""}
                      </Txt>
                      <Txt variant="label" color={colors.muted}>{wasteLabels[r.waste_type] || r.waste_type || ""}</Txt>
                      <View style={styles.routeStats}>
                        <Stat label="RECOLHAS" value={r.num_stops} />
                        <Stat label="DISTÂNCIA" value={`${r.distance_km} km`} />
                        <Stat label="DURAÇÃO" value={`${Math.round(r.duration_min)} min`} />
                        <Stat label="CAPACIDADE" value={`${r.capacity_utilization}%`} />
                      </View>
                    </View>
                  </Pressable>
                );
              })
            )}
          </>
        ) : (
          <>
            <View style={styles.formHead}>
              <Txt variant="label">NOVA ROTA</Txt>
              <Pressable testID="cancel-create-route" onPress={() => setCreating(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <Txt variant="label">DATA</Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {DATE_OPTIONS.map((d) => (
                <Pressable key={d.date} onPress={() => setDate(d.date)} style={[styles.chip, date === d.date ? styles.chipOn : null]}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={date === d.date ? colors.onSurfaceInverse : colors.onSurface}>{d.label}</Txt>
                </Pressable>
              ))}
            </ScrollView>

            <Txt variant="label">CONTENTORES / RECOLHAS</Txt>
            <ContainerPicker value={containerIds} onChange={setContainerIds} forDate={date} />

            <Txt variant="label">VIATURAS DISPONÍVEIS</Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {vehicles.map((v) => {
                const on = vehicleIds.includes(v.id);
                const st = vehicleStatus[v.status] || vehicleStatus.offline;
                return (
                  <Pressable
                    key={v.id}
                    testID={`vehicle-chip-${v.id}`}
                    onPress={() => setVehicleIds((s) => (on ? s.filter((x) => x !== v.id) : [...s, v.id]))}
                    style={[styles.pickChip, on ? styles.chipOn : null]}
                  >
                    <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>
                      {vehicleLabel(v)}
                    </Txt>
                    <Txt variant="label" color={on ? "#D1D5DB" : st.color}>{st.label}</Txt>
                  </Pressable>
                );
              })}
            </ScrollView>
            {vehicleIds.length === 0 && (
              <View style={styles.stepperRow}>
                <Txt variant="mono" color={colors.muted}>Nº de camiões (automático)</Txt>
                <View style={styles.stepper}>
                  <Pressable onPress={() => setNumTrucks((t) => Math.max(1, t - 1))} style={styles.stepBtn}>
                    <Ionicons name="remove" size={18} color={colors.onSurface} />
                  </Pressable>
                  <Txt variant="monoBold" style={{ fontSize: 16, minWidth: 26, textAlign: "center" }}>{numTrucks}</Txt>
                  <Pressable onPress={() => setNumTrucks((t) => Math.min(6, t + 1))} style={styles.stepBtn}>
                    <Ionicons name="add" size={18} color={colors.onSurface} />
                  </Pressable>
                </View>
              </View>
            )}

            <Txt variant="label">MOTORISTAS DISPONÍVEIS</Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {drivers.map((d) => {
                const on = driverIds.includes(d.id);
                return (
                  <Pressable
                    key={d.id}
                    testID={`driver-chip-${d.id}`}
                    onPress={() => setDriverIds((s) => (on ? s.filter((x) => x !== d.id) : [...s, d.id]))}
                    style={[styles.chip, on ? styles.chipOn : null]}
                  >
                    <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{d.name}</Txt>
                  </Pressable>
                );
              })}
            </ScrollView>
            {vehicleIds.length === 0 && driverIds.length === 0 ? null : (
              <Txt variant="label" color={colors.muted}>Sem seleção manual → atribuição automática (como hoje).</Txt>
            )}

            <Txt variant="label">DEPÓSITO DE INÍCIO</Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <Pressable onPress={() => setDepotId(null)} style={[styles.chip, !depotId ? styles.chipOn : null]}>
                <Txt variant="monoBold" style={{ fontSize: 11 }} color={!depotId ? colors.onSurfaceInverse : colors.onSurface}>AUTOMÁTICO</Txt>
              </Pressable>
              {depots.map((d) => (
                <Pressable key={d.id} onPress={() => setDepotId(d.id)} style={[styles.chip, depotId === d.id ? styles.chipOn : null]}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={depotId === d.id ? colors.onSurfaceInverse : colors.onSurface}>
                    {d.is_primary ? `★ ${d.name}` : d.name}
                  </Txt>
                </Pressable>
              ))}
            </ScrollView>

            <Txt variant="label">CENTRO DE TRATAMENTO / DESTINO FINAL</Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <Pressable onPress={() => setFacilityId(null)} style={[styles.chip, !facilityId ? styles.chipOn : null]}>
                <Txt variant="monoBold" style={{ fontSize: 11 }} color={!facilityId ? colors.onSurfaceInverse : colors.onSurface}>AUTOMÁTICO</Txt>
              </Pressable>
              {facilities.map((f) => (
                <Pressable key={f.id} onPress={() => setFacilityId(f.id)} style={[styles.chip, facilityId === f.id ? styles.chipOn : null]}>
                  <Txt variant="monoBold" style={{ fontSize: 11 }} color={facilityId === f.id ? colors.onSurfaceInverse : colors.onSurface}>{f.name}</Txt>
                </Pressable>
              ))}
            </ScrollView>

            <Btn testID="generate-routes-button" title="GERAR ROTAS" icon="git-network" size="lg" loading={optimizing} onPress={generate} style={{ marginTop: spacing.md }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <View style={{ flex: 1 }}>
      <Txt variant="monoBold" style={{ fontSize: 15 }}>{value}</Txt>
      <Txt variant="label" style={{ fontSize: 9 }}>{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  createRow: { flexDirection: "row", gap: spacing.sm },
  statusFilterRow: { flexDirection: "row", gap: spacing.sm },
  formHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chipRow: { gap: spacing.sm, paddingVertical: 2 },
  chip: {
    height: 34, justifyContent: "center", paddingHorizontal: spacing.md,
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  pickChip: {
    minWidth: 160, gap: 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.onSurface },
  templateTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepper: { flexDirection: "row", alignItems: "center", borderWidth: border.width, borderColor: colors.border, borderRadius: radius.pill },
  stepBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  routeCard: { borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, backgroundColor: colors.surface },
  routeHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stTag: { borderRadius: radius.xs, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  routeStats: { flexDirection: "row", marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs },
});
