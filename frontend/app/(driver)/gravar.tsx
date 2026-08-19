import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api";
import { getCurrentLocation } from "@/src/utils/location";
import { getLiveStats, resetLiveStats, flushQueue, pendingCount, clearRecording } from "@/src/tracking/recordingEngine";
import { markRecordingActive, markRecordingStopped } from "@/src/tracking/activeContext";
import { ScreenHeader } from "@/src/components/Header";
import { Btn, Card, ConfirmModal, Txt, useToast } from "@/src/components/ui";
import { colors, spacing, border, radius } from "@/src/theme";

// FASE MOBILE 1: GPS capture for a recording no longer happens in this
// screen — it happens in the WASTEFLOW_BACKGROUND_LOCATION task (see
// src/tracking/backgroundLocationTask.ts), which keeps running whether this
// screen is mounted, the app is backgrounded, or the phone is locked. This
// screen only starts/stops the recording and polls the shared engine's
// on-disk stats for display — it must never also watch position itself, or
// every reading would be captured twice.
const POLL_MS = 2000;

function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function GravarTrajeto() {
  const toast = useToast();
  const [session, setSession] = useState<any | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [capturedCount, setCapturedCount] = useState(0);
  const [pendingN, setPendingN] = useState(0);
  const [backgroundOk, setBackgroundOk] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [confirmStartOpen, setConfirmStartOpen] = useState(false);
  const [confirmFinishOpen, setConfirmFinishOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // Resume a recording already in progress if this screen (re)mounts — the
  // backend is the source of truth for "is there a recording right now",
  // never a locally-remembered flag, so a stale local state can't resurrect
  // a session the backend already considers finished.
  useEffect(() => {
    (async () => {
      try {
        const list = await api.get<any[]>("/tracking-sessions");
        const active = list.find((s) => s.status === "recording");
        if (!active) return;
        setSession(active);
        const ok = await markRecordingActive(active.id);
        setBackgroundOk(ok);
      } catch {}
    })();
  }, []);

  // Poll the shared engine's on-disk stats — this is display-only; it never
  // drives GPS capture (the background task does that independently).
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const tick = async () => {
      const stats = await getLiveStats(session.id);
      const pending = await pendingCount(session.id);
      if (cancelled) return;
      if (stats) { setDistanceKm(stats.distanceKm); setCapturedCount(stats.pointCount); }
      setPendingN(pending);
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [session]);

  useEffect(() => {
    if (!session) { setElapsedSec(0); return; }
    const startedMs = new Date(session.started_at).getTime();
    const tick = () => setElapsedSec(Math.max(0, (Date.now() - startedMs) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session]);

  const startRecording = async () => {
    setConfirmStartOpen(false);
    setStarting(true);
    try {
      const loc = await getCurrentLocation();
      const sessionDoc = await api.post<any>("/tracking-sessions/start", { lat: loc.lat, lng: loc.lng });
      await resetLiveStats(sessionDoc.id, loc.lat, loc.lng);
      setDistanceKm(0);
      setCapturedCount(0);
      setPendingN(0);
      setSession(sessionDoc);
      const ok = await markRecordingActive(sessionDoc.id);
      setBackgroundOk(ok);
      if (!ok) {
        toast("Gravação iniciada, mas sem permissão de localização em segundo plano — só regista enquanto a app estiver aberta", "info");
      }
    } catch (e: any) {
      toast(e?.message || "Não foi possível iniciar a gravação", "error");
    } finally {
      setStarting(false);
    }
  };

  const finishRecording = async () => {
    if (!session) return;
    setFinishing(true);
    try {
      const ok = await flushQueue(session.id);
      const remaining = await pendingCount(session.id);
      if (!ok || remaining > 0) {
        setPendingN(remaining);
        toast("Ainda há pontos por sincronizar — tente novamente com melhor rede", "error");
        return;
      }
      await api.post(`/tracking-sessions/${session.id}/finish`, {});
      await markRecordingStopped();
      await clearRecording();
      setSession(null);
      toast("Trajeto guardado", "success");
    } catch (e: any) {
      toast(e?.message || "Erro ao terminar a gravação", "error");
    } finally {
      setFinishing(false);
      setConfirmFinishOpen(false);
    }
  };

  const cancelRecording = async () => {
    if (!session) return;
    setFinishing(true);
    try {
      await flushQueue(session.id);
      await api.post(`/tracking-sessions/${session.id}/cancel`, {});
      await markRecordingStopped();
      await clearRecording();
      setSession(null);
      toast("Gravação cancelada", "info");
    } catch (e: any) {
      toast(e?.message || "Erro ao cancelar", "error");
    } finally {
      setFinishing(false);
      setConfirmCancelOpen(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader title="GRAVAR TRAJETO" subtitle="MOTORISTA" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.limitBanner}>
          <Ionicons name="information-circle" size={16} color={colors.onSurfaceSecondary} />
          <Txt variant="mono" color={colors.onSurfaceSecondary} style={{ flex: 1, fontSize: 12 }}>
            {backgroundOk === false
              ? "Sem permissão de localização \"Sempre\" — a gravação só regista enquanto a app estiver aberta e visível."
              : "Com permissão de localização \"Sempre\" concedida, a gravação continua com o ecrã bloqueado ou a app em segundo plano."}
          </Txt>
        </View>

        {!session ? (
          <Card style={{ gap: spacing.md, alignItems: "center", padding: spacing["2xl"] }}>
            <View style={styles.recordIconWrap}>
              <Ionicons name="radio-button-on" size={34} color={colors.error} />
            </View>
            <Txt variant="display" style={{ textAlign: "center", fontSize: 20 }}>Gravar um trajeto real</Txt>
            <Txt variant="mono" color={colors.muted} style={{ textAlign: "center" }}>
              Use isto para registar uma volta que já conhece bem — fica guardada para o administrador poder consultar ou usar como referência para uma rota.
            </Txt>
            <Btn testID="start-recording" title="GRAVAR TRAJETO" icon="radio-button-on" size="xl" variant="error"
              loading={starting} onPress={() => setConfirmStartOpen(true)} style={{ alignSelf: "stretch", marginTop: spacing.sm }} />
          </Card>
        ) : (
          <>
            <View testID="recording-badge" style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Txt variant="monoBold" color="#fff">TRAJETO A SER GRAVADO</Txt>
            </View>

            <View testID="sync-status" style={[styles.syncRow, pendingN > 0 ? styles.syncPending : styles.syncOk]}>
              <Ionicons name={pendingN > 0 ? "cloud-upload-outline" : "checkmark-circle"} size={14}
                color={pendingN > 0 ? colors.warning : colors.success} />
              <Txt variant="mono" style={{ fontSize: 12 }} color={pendingN > 0 ? colors.onWarning : colors.success}>
                {pendingN > 0 ? `${pendingN} ponto${pendingN === 1 ? "" : "s"} por sincronizar` : "Tudo sincronizado"}
              </Txt>
            </View>

            <View style={styles.statGrid}>
              <StatCell label="TEMPO" value={formatElapsed(elapsedSec)} />
              <StatCell label="DISTÂNCIA" value={`${distanceKm.toFixed(1).replace(".", ",")} km`} />
              <StatCell label="PONTOS GPS" value={String(capturedCount)} />
              <StatCell label="ESTADO" value="A gravar" accent={colors.error} />
            </View>

            <Btn testID="finish-recording" title="TERMINAR GRAVAÇÃO" icon="stop-circle" size="xl" variant="dark"
              loading={finishing} onPress={() => setConfirmFinishOpen(true)} />
            <Btn testID="cancel-recording" title="Cancelar gravação" variant="outline" size="sm"
              disabled={finishing} onPress={() => setConfirmCancelOpen(true)} />
          </>
        )}
      </ScrollView>

      <ConfirmModal
        visible={confirmStartOpen} title="Gravar trajeto"
        message="Pretende começar a gravar este percurso?"
        confirmLabel="COMEÇAR" cancelLabel="CANCELAR"
        loading={starting} onConfirm={startRecording} onCancel={() => setConfirmStartOpen(false)}
      />
      <ConfirmModal
        visible={confirmFinishOpen} title="Terminar gravação"
        message="Pretende terminar e guardar este trajeto?"
        confirmLabel="TERMINAR" cancelLabel="CANCELAR"
        loading={finishing} onConfirm={finishRecording} onCancel={() => setConfirmFinishOpen(false)}
      />
      <ConfirmModal
        visible={confirmCancelOpen} title="Cancelar gravação" destructive
        message="O trajeto gravado até agora não vai ficar disponível como um trajeto concluído."
        confirmLabel="CANCELAR GRAVAÇÃO" cancelLabel="VOLTAR"
        loading={finishing} onConfirm={cancelRecording} onCancel={() => setConfirmCancelOpen(false)}
      />
    </View>
  );
}

function StatCell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.statCell}>
      <Txt variant="display" color={accent} style={{ fontSize: 20 }}>{value}</Txt>
      <Txt variant="label">{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },
  limitBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, padding: spacing.sm,
  },
  recordIconWrap: {
    width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.errorSoft,
    alignItems: "center", justifyContent: "center",
  },
  recordingBadge: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.error,
    borderRadius: radius.md, padding: spacing.md, justifyContent: "center",
  },
  recordingDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: "#fff" },
  syncRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "center", paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: radius.pill },
  syncPending: { backgroundColor: colors.warningSoft },
  syncOk: { backgroundColor: colors.successSoft },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  statCell: {
    width: "47%", padding: spacing.md, backgroundColor: colors.surface, borderWidth: border.width,
    borderColor: colors.border, borderRadius: radius.md, gap: 2,
  },
});
