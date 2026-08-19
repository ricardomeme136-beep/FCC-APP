import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Badge, Btn, CompactCard, Empty, Loading, SearchInput, Txt, useToast } from "@/src/components/ui";
import { colors, spacing, border, radius, vehicleStatus, wasteLabels } from "@/src/theme";

const WASTE_TYPES = Object.keys(wasteLabels);

export default function Viaturas() {
  const toast = useToast();
  const [items, setItems] = useState<any[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const [plate, setPlate] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [capacity, setCapacity] = useState("10000");
  const [wasteTypes, setWasteTypes] = useState<string[]>([]);

  const load = useCallback(async () => {
    const v = await api.get<any[]>("/vehicles");
    setItems(v);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setPlate(""); setBrand(""); setModel(""); setYear(""); setCapacity("10000"); setWasteTypes([]);
  };

  const toggleWasteType = (wt: string) => {
    setWasteTypes((prev) => prev.includes(wt) ? prev.filter((w) => w !== wt) : [...prev, wt]);
  };

  const createVehicle = async () => {
    if (!plate.trim()) { toast("Indique a matrícula", "error"); return; }
    setBusy(true);
    try {
      await api.post("/vehicles", {
        plate: plate.trim().toUpperCase(), brand, model,
        year: year ? Number(year) : undefined,
        capacity_kg: capacity ? Number(capacity) : undefined,
        allowed_waste_types: wasteTypes,
      });
      toast("Viatura criada", "success");
      resetForm();
      setCreating(false);
      await load();
    } catch (e: any) {
      toast(e?.message || "Erro ao criar viatura", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!items) {
    return (<View style={styles.flex}><ScreenHeader title="VIATURAS" subtitle="FROTA" back /><Loading /></View>);
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="VIATURAS" subtitle={`${items.length} na frota`} back />
      <ScrollView contentContainerStyle={styles.scroll}>
        {!creating ? (
          <Btn testID="start-create-vehicle" title="NOVA VIATURA" icon="add-circle" size="sm" onPress={() => setCreating(true)} />
        ) : (
          <View style={styles.form}>
            <View style={styles.formHead}>
              <Txt variant="label">NOVA VIATURA</Txt>
              <Pressable testID="cancel-create-vehicle" onPress={() => { setCreating(false); resetForm(); }} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <Field label="MATRÍCULA" value={plate} onChangeText={setPlate} autoCapitalize="characters" placeholder="00-AA-00" />
            <Field label="MARCA" value={brand} onChangeText={setBrand} placeholder="ex. Mercedes" />
            <Field label="MODELO" value={model} onChangeText={setModel} placeholder="ex. Econic" />
            <Field label="ANO" value={year} onChangeText={setYear} keyboardType="number-pad" placeholder="ex. 2022" />
            <Field label="CAPACIDADE (KG)" value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />

            <Txt variant="label" style={{ marginTop: spacing.md }}>RESÍDUOS PERMITIDOS (OPCIONAL — VAZIO = TODOS)</Txt>
            <View style={styles.chipRow}>
              {WASTE_TYPES.map((wt) => {
                const on = wasteTypes.includes(wt);
                return (
                  <Pressable key={wt} testID={`waste-chip-${wt}`} style={[styles.chip, on ? styles.chipOn : null]} onPress={() => toggleWasteType(wt)}>
                    <Txt variant="monoBold" style={{ fontSize: 11 }} color={on ? colors.onSurfaceInverse : colors.onSurface}>{wasteLabels[wt]}</Txt>
                  </Pressable>
                );
              })}
            </View>

            <Btn testID="confirm-create-vehicle" title="CRIAR" loading={busy} onPress={createVehicle} style={{ marginTop: spacing.md }} />
          </View>
        )}

        {items.length > 0 && !creating && (
          <SearchInput testID="search-vehicles" value={search} onChangeText={setSearch} placeholder="Pesquisar por matrícula, marca..." />
        )}

        {items.length === 0 ? (
          <Empty text="Sem viaturas" icon="bus-outline" />
        ) : (
          items
            .filter((v) => !search || [v.plate, v.brand, v.model].some((f) => f?.toLowerCase().includes(search.toLowerCase())))
            .map((v) => {
              const st = vehicleStatus[v.status] || vehicleStatus.offline;
              return (
                <CompactCard key={v.id} style={styles.card} testID={`vehicle-row-${v.id}`}>
                  <View style={styles.head}>
                    <Txt variant="title">{v.plate}</Txt>
                    <Badge label={st.label} color={st.color} />
                  </View>
                  <Txt variant="mono" color={colors.muted} style={{ fontSize: 13 }}>{v.brand} {v.model} · {v.year}</Txt>
                  <View style={styles.metaRow}>
                    <Txt variant="label">CAP {v.capacity_kg}kg</Txt>
                    <Txt variant="label">KM {v.mileage_km?.toLocaleString?.("pt-PT") || "—"}</Txt>
                    <Txt variant="label">COMB {v.fuel_pct ?? "—"}%</Txt>
                  </View>
                  {v.allowed_waste_types?.length ? (
                    <Txt variant="label">RESÍDUOS: {v.allowed_waste_types.map((w: string) => wasteLabels[w]).join(", ")}</Txt>
                  ) : <Txt variant="label">TODOS OS RESÍDUOS</Txt>}
                </CompactCard>
              );
            })
        )}
      </ScrollView>
    </View>
  );
}

function Field({ label, ...rest }: any) {
  return (
    <>
      <Txt variant="label" style={{ marginTop: spacing.xs }}>{label}</Txt>
      <TextInput style={styles.input} placeholderTextColor={colors.muted} {...rest} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  card: { gap: spacing.xs },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metaRow: { flexDirection: "row", gap: spacing.md, marginTop: 2 },
  form: { borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs, backgroundColor: colors.surface },
  formHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  input: {
    borderWidth: border.width, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, height: 46, fontFamily: "SpaceGrotesk-Regular",
    fontSize: 14, color: colors.onSurface, backgroundColor: colors.bg,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingVertical: 2 },
  chip: { height: 34, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.bg },
  chipOn: { backgroundColor: colors.onSurface },
});
