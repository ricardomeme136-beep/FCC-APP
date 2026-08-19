import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { Loading, Txt } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { colors, spacing, border, radius, wasteColors, wasteLabels } from "@/src/theme";
import { estimateStopCount } from "@/src/utils/geo";

type Container = {
  id: string;
  address: string;
  qr_code: string;
  lat: number;
  lng: number;
  waste_type: string;
  zone_id?: string | null;
  available?: boolean;
  unavailable_reason?: string | null;
};
type Zone = { id: string; name: string };

type Props = {
  value: string[];
  onChange: (ids: string[]) => void;
  initialZoneId?: string;
  forDate?: string;
  style?: any;
};

type AvailFilter = "available" | "assigned" | "all";

// Shared container selection UI — used by the route-creation form and by
// "Adicionar Paragem" on the route detail screen. Refetches on every focus
// (not just first mount) — a container created on another tab must show up
// here the moment the admin comes back, not only after a full app reload.
export default function ContainerPicker({ value, onChange, initialZoneId, forDate, style }: Props) {
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [wasteTypes, setWasteTypes] = useState<{ code: string; label: string }[]>([]);
  const [zoneFilter, setZoneFilter] = useState<string | null>(initialZoneId || null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [availFilter, setAvailFilter] = useState<AvailFilter>("available");
  const [search, setSearch] = useState("");

  useFocusEffect(
    useCallback(() => {
      const qs = forDate ? `for_date=${forDate}` : "status=active";
      Promise.all([
        api.get<Container[]>(`/containers?${qs}&limit=2000`),
        api.get<Zone[]>("/zones"),
        api.get<{ code: string; label: string }[]>("/waste-types"),
      ]).then(([c, z, w]) => {
        setContainers(c);
        setZones(z);
        setWasteTypes(w);
      });
    }, [forDate])
  );

  const filtered = useMemo(() => {
    if (!containers) return [];
    const q = search.trim().toLowerCase();
    return containers.filter((c) => {
      if (zoneFilter && c.zone_id !== zoneFilter) return false;
      if (typeFilter && c.waste_type !== typeFilter) return false;
      if (q && !c.address.toLowerCase().includes(q) && !c.qr_code.toLowerCase().includes(q)) return false;
      if (forDate) {
        if (availFilter === "available" && c.available === false) return false;
        if (availFilter === "assigned" && c.available !== false) return false;
      }
      return true;
    });
  }, [containers, zoneFilter, typeFilter, search, availFilter, forDate]);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const allVisibleSelectable = filtered.filter((c) => c.available !== false);
  const allVisibleSelected = allVisibleSelectable.length > 0 && allVisibleSelectable.every((c) => selectedSet.has(c.id));

  const toggle = (c: Container) => {
    if (c.available === false) return;
    onChange(selectedSet.has(c.id) ? value.filter((x) => x !== c.id) : [...value, c.id]);
  };
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(allVisibleSelectable.map((c) => c.id));
      onChange(value.filter((id) => !visibleIds.has(id)));
    } else {
      const merged = new Set(value);
      allVisibleSelectable.forEach((c) => merged.add(c.id));
      onChange(Array.from(merged));
    }
  };

  const approxStops = useMemo(() => {
    if (!containers) return 0;
    const selected = containers.filter((c) => selectedSet.has(c.id));
    return estimateStopCount(selected.map((c) => ({ lat: c.lat, lng: c.lng })));
  }, [containers, selectedSet]);

  // Selected containers get a numbered marker (order they were picked in) —
  // seeing the whole spread on the map is how an admin groups nearby stops
  // into one route by eye, instead of guessing from an address list.
  const mapMarkers = useMemo(() => {
    return filtered
      .filter((c) => typeof c.lat === "number" && typeof c.lng === "number")
      .map((c) => {
        const order = value.indexOf(c.id);
        const selected = order !== -1;
        const disabled = c.available === false;
        return {
          id: c.id, lat: c.lat, lng: c.lng,
          color: selected ? colors.brand : disabled ? colors.muted : (wasteColors[c.waste_type] || colors.info),
          label: selected ? String(order + 1) : undefined,
          selected,
        };
      });
  }, [filtered, value]);

  const onMarkerPress = useCallback((id: string) => {
    const c = filtered.find((x) => x.id === id);
    if (c) toggle(c);
  }, [filtered, value]);

  if (!containers) return <Loading text="A carregar contentores..." />;

  return (
    <View style={[styles.wrap, style]}>
      {mapMarkers.length > 0 && (
        <>
          <View style={styles.mapBox}>
            <FleetMap markers={mapMarkers} onPressMarker={onMarkerPress} />
          </View>
          <Txt variant="label" color={colors.muted}>
            TOCA NUM PONTO PARA SELECIONAR — OS SELECIONADOS FICAM NUMERADOS PELA ORDEM ESCOLHIDA
          </Txt>
        </>
      )}

      <TextInput
        testID="container-picker-search"
        style={styles.search}
        placeholder="Pesquisar por morada ou código..."
        placeholderTextColor={colors.muted}
        value={search}
        onChangeText={setSearch}
      />

      {forDate && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip label="DISPONÍVEIS" active={availFilter === "available"} onPress={() => setAvailFilter("available")} testID="avail-filter-available" />
          <Chip label="JÁ ATRIBUÍDOS" active={availFilter === "assigned"} onPress={() => setAvailFilter("assigned")} testID="avail-filter-assigned" />
          <Chip label="TODOS" active={availFilter === "all"} onPress={() => setAvailFilter("all")} testID="avail-filter-all" />
        </ScrollView>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        <Chip label="TODAS AS ZONAS" active={!zoneFilter} onPress={() => setZoneFilter(null)} />
        {zones.map((z) => (
          <Chip key={z.id} label={z.name} active={zoneFilter === z.id} onPress={() => setZoneFilter(z.id)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        <Chip label="TODOS OS RESÍDUOS" active={!typeFilter} onPress={() => setTypeFilter(null)} />
        {wasteTypes.map((w) => (
          <Chip key={w.code} label={w.label} active={typeFilter === w.code} onPress={() => setTypeFilter(w.code)} />
        ))}
      </ScrollView>

      <View style={styles.summaryRow}>
        <Pressable testID="container-picker-select-all" onPress={toggleAllVisible} style={styles.selectAllBtn}>
          <Ionicons name={allVisibleSelected ? "checkbox" : "square-outline"} size={18} color={colors.brand} />
          <Txt variant="monoBold" style={{ fontSize: 12 }} color={colors.brand}>
            {allVisibleSelected ? "DESSELECIONAR VISÍVEIS" : "SELECIONAR TODOS"}
          </Txt>
        </Pressable>
        <Txt variant="label">
          {value.length} selecionados · ~{approxStops} paragens
        </Txt>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={{ gap: spacing.xs }}>
        {filtered.length === 0 ? (
          <Txt variant="mono" color={colors.muted} style={{ padding: spacing.md }}>
            Sem contentores para estes filtros.
          </Txt>
        ) : (
          filtered.map((c) => {
            const selected = selectedSet.has(c.id);
            const disabled = c.available === false;
            return (
              <Pressable
                key={c.id}
                testID={`container-row-${c.id}`}
                onPress={() => toggle(c)}
                style={[styles.row, selected ? styles.rowSelected : null, disabled ? styles.rowDisabled : null]}
              >
                <Ionicons
                  name={disabled ? "lock-closed" : selected ? "checkbox" : "square-outline"}
                  size={20}
                  color={disabled ? colors.muted : selected ? colors.brand : colors.muted}
                />
                <View style={[styles.wasteDot, { backgroundColor: wasteColors[c.waste_type] || colors.info }]} />
                <View style={{ flex: 1 }}>
                  <Txt variant="mono" numberOfLines={1} color={disabled ? colors.muted : colors.onSurface}>{c.address || "Sem morada"}</Txt>
                  <Txt variant="label">{wasteLabels[c.waste_type] || c.waste_type} · {c.qr_code}</Txt>
                  {disabled && c.unavailable_reason ? (
                    <Txt variant="label" color={colors.warning} style={{ marginTop: 2 }}>
                      {c.qr_code} — {c.unavailable_reason}
                    </Txt>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.chip, active ? styles.chipOn : null]}>
      <Txt variant="monoBold" style={{ fontSize: 11 }} color={active ? colors.onSurfaceInverse : colors.onSurface}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  mapBox: { height: 240, borderWidth: border.width, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden" },
  search: {
    borderWidth: border.width, borderColor: colors.border, borderRadius: 16,
    paddingHorizontal: spacing.md, height: 44, fontFamily: "SpaceGrotesk-Regular",
    fontSize: 14, color: colors.onSurface, backgroundColor: colors.surface,
  },
  chipRow: { gap: spacing.sm, paddingVertical: 2 },
  chip: {
    height: 32, justifyContent: "center", paddingHorizontal: spacing.md,
    borderWidth: border.width, borderColor: colors.border, borderRadius: 16,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.onSurface },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.xs },
  selectAllBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  list: { maxHeight: 320 },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    borderWidth: border.width, borderColor: colors.border, borderRadius: 16,
    padding: spacing.sm, backgroundColor: colors.surface,
  },
  rowSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  rowDisabled: { opacity: 0.6 },
  wasteDot: { width: 10, height: 10, borderRadius: 5 },
});
