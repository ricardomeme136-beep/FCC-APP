import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { Loading, Txt } from "@/src/components/ui";
import { colors, spacing, border, wasteColors, wasteLabels } from "@/src/theme";
import { estimateStopCount } from "@/src/utils/geo";

type Container = {
  id: string;
  address: string;
  qr_code: string;
  lat: number;
  lng: number;
  waste_type: string;
  zone_id?: string | null;
};
type Zone = { id: string; name: string };

type Props = {
  value: string[];
  onChange: (ids: string[]) => void;
  initialZoneId?: string;
  style?: any;
};

// Shared container selection UI — used by the route-creation form and by
// "Adicionar Paragem" on the route detail screen. Fetches once, filters
// client-side (zone/type/search) so toggling a chip feels instant.
export default function ContainerPicker({ value, onChange, initialZoneId, style }: Props) {
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [wasteTypes, setWasteTypes] = useState<{ code: string; label: string }[]>([]);
  const [zoneFilter, setZoneFilter] = useState<string | null>(initialZoneId || null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([
      api.get<Container[]>("/containers?status=active&limit=2000"),
      api.get<Zone[]>("/zones"),
      api.get<{ code: string; label: string }[]>("/waste-types"),
    ]).then(([c, z, w]) => {
      setContainers(c);
      setZones(z);
      setWasteTypes(w);
    });
  }, []);

  const filtered = useMemo(() => {
    if (!containers) return [];
    const q = search.trim().toLowerCase();
    return containers.filter((c) => {
      if (zoneFilter && c.zone_id !== zoneFilter) return false;
      if (typeFilter && c.waste_type !== typeFilter) return false;
      if (q && !c.address.toLowerCase().includes(q) && !c.qr_code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [containers, zoneFilter, typeFilter, search]);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const allVisibleSelected = filtered.length > 0 && filtered.every((c) => selectedSet.has(c.id));

  const toggle = (id: string) => {
    onChange(selectedSet.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(filtered.map((c) => c.id));
      onChange(value.filter((id) => !visibleIds.has(id)));
    } else {
      const merged = new Set(value);
      filtered.forEach((c) => merged.add(c.id));
      onChange(Array.from(merged));
    }
  };

  const approxStops = useMemo(() => {
    if (!containers) return 0;
    const selected = containers.filter((c) => selectedSet.has(c.id));
    return estimateStopCount(selected.map((c) => ({ lat: c.lat, lng: c.lng })));
  }, [containers, selectedSet]);

  if (!containers) return <Loading text="A carregar contentores..." />;

  return (
    <View style={[styles.wrap, style]}>
      <TextInput
        testID="container-picker-search"
        style={styles.search}
        placeholder="Pesquisar por morada ou código..."
        placeholderTextColor={colors.muted}
        value={search}
        onChangeText={setSearch}
      />

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
            return (
              <Pressable
                key={c.id}
                testID={`container-row-${c.id}`}
                onPress={() => toggle(c.id)}
                style={[styles.row, selected ? styles.rowSelected : null]}
              >
                <Ionicons name={selected ? "checkbox" : "square-outline"} size={20} color={selected ? colors.brand : colors.muted} />
                <View style={[styles.wasteDot, { backgroundColor: wasteColors[c.waste_type] || colors.info }]} />
                <View style={{ flex: 1 }}>
                  <Txt variant="mono" numberOfLines={1}>{c.address || "Sem morada"}</Txt>
                  <Txt variant="label">{wasteLabels[c.waste_type] || c.waste_type} · {c.qr_code}</Txt>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active ? styles.chipOn : null]}>
      <Txt variant="monoBold" style={{ fontSize: 11 }} color={active ? colors.onSurfaceInverse : colors.onSurface}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
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
  wasteDot: { width: 10, height: 10, borderRadius: 5 },
});
