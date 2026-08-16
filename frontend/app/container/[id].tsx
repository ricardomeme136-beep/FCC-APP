import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Badge, Loading, Txt } from "@/src/components/ui";
import FleetMap from "@/src/components/FleetMap";
import { colors, spacing, border, wasteColors, wasteLabels, taskStatus } from "@/src/theme";

export default function ContainerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c, setC] = useState<any | null>(null);
  useEffect(() => { api.get<any>(`/containers/${id}`).then(setC); }, [id]);
  if (!c) return (<View style={styles.flex}><ScreenHeader title="CONTENTOR" back /><Loading /></View>);

  return (
    <View style={styles.flex}>
      <ScreenHeader title={c.qr_code} subtitle="CONTENTOR" back />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.qrCard}>
          <QRCode value={c.qr_code} size={130} />
          <Txt variant="label" style={{ marginTop: spacing.sm }}>CÓDIGO QR ÚNICO</Txt>
        </View>

        <View style={styles.wasteTag}>
          <View style={[styles.wasteDot, { backgroundColor: wasteColors[c.waste_type] }]} />
          <Txt variant="monoBold">{wasteLabels[c.waste_type] || c.waste_type}</Txt>
        </View>

        <View style={styles.infoCard}>
          <Row k="Morada" v={c.address} />
          <Row k="Tipo" v={c.container_type} />
          <Row k="Capacidade" v={`${c.capacity_kg} kg`} />
          <Row k="Frequência" v={c.frequency} />
          <Row k="Dias" v={(c.schedule_days || []).join(", ")} />
          <Row k="Estado" v={c.status === "active" ? "Ativo" : c.status} />
          <Row k="Última recolha" v={c.last_collection ? c.last_collection.slice(0, 10) : "—"} />
          <Row k="Coordenadas" v={`${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`} />
        </View>

        <View style={styles.mapBox}>
          <FleetMap markers={[{ id: c.id, lat: c.lat, lng: c.lng, color: wasteColors[c.waste_type] }]} />
        </View>

        <Txt variant="label">HISTÓRICO DE RECOLHAS ({(c.history || []).length})</Txt>
        {(c.history || []).slice(0, 20).map((h: any) => {
          const ts = taskStatus[h.status] || taskStatus.scheduled;
          return (
            <View key={h.id} style={styles.histRow}>
              <Txt variant="mono" color={colors.muted}>{h.scheduled_date}</Txt>
              <Badge label={ts.label} color={ts.color} />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (<View style={styles.row}><Txt variant="mono" color={colors.muted}>{k}</Txt><Txt variant="monoBold" style={{ flex: 1, textAlign: "right" }} numberOfLines={1}>{v}</Txt></View>);
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  qrCard: { alignItems: "center", borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, backgroundColor: colors.surface },
  wasteTag: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  wasteDot: { width: 16, height: 16 },
  infoCard: { borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  mapBox: { height: 160, borderWidth: border.width, borderColor: colors.border, borderRadius: 16 },
  histRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.md },
});
