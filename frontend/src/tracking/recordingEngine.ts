// Pure-JS recording logic shared between the GRAVAR TRAJETO screen (while
// mounted, foreground) and the background location task — see
// backgroundLocationTask.ts. Exactly ONE of those two ever calls
// appendPoint() for a given reading (the background task, always — the
// screen only polls getLiveStats()/pendingCount() for display), so a GPS
// reading is never captured twice. Both may call flushQueue() though (the
// screen on mount/finish, the task after every batch of updates), so it
// re-reads the on-disk queue immediately before writing back rather than
// trusting a stale in-memory copy — shrinks (does not eliminate — AsyncStorage
// has no real locking) the window where a concurrent appendPoint() could be
// clobbered by a flush that started before it landed.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/api";
import { haversineKm } from "@/src/utils/geo";
import { uuidv4 } from "@/src/utils/uuid";
import { loadQueue, saveQueue, clearQueue, QueuedPoint } from "@/src/utils/trackingQueue";

const CHUNK_SIZE = 20;
const STATS_KEY = "wf_tracking_live_stats_v1";

export type RawPoint = {
  lat: number; lng: number;
  speed?: number | null; heading?: number | null; accuracy?: number | null; altitude?: number | null;
};

type LiveStats = { sessionId: string; distanceKm: number; pointCount: number; lastLat: number; lastLng: number };

async function readStats(sessionId: string): Promise<LiveStats | null> {
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    if (!raw) return null;
    const s: LiveStats = JSON.parse(raw);
    return s.sessionId === sessionId ? s : null;
  } catch {
    return null;
  }
}

async function writeStats(stats: LiveStats): Promise<void> {
  try { await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch {}
}

export async function getLiveStats(sessionId: string): Promise<{ distanceKm: number; pointCount: number } | null> {
  const s = await readStats(sessionId);
  return s ? { distanceKm: s.distanceKm, pointCount: s.pointCount } : null;
}

export async function resetLiveStats(sessionId: string, startLat: number, startLng: number): Promise<void> {
  await writeStats({ sessionId, distanceKm: 0, pointCount: 0, lastLat: startLat, lastLng: startLng });
}

export async function clearLiveStats(): Promise<void> {
  try { await AsyncStorage.removeItem(STATS_KEY); } catch {}
}

// Appends ONE raw GPS reading to the persistent queue for `sessionId` and
// updates the running distance/point-count stats the UI polls.
export async function appendPoint(sessionId: string, p: RawPoint): Promise<void> {
  const point: QueuedPoint = {
    point_uuid: uuidv4(), lat: p.lat, lng: p.lng, timestamp: new Date().toISOString(),
    speed: p.speed ?? undefined, heading: p.heading ?? undefined,
    accuracy: p.accuracy ?? undefined, altitude: p.altitude ?? undefined,
  };
  const queue = await loadQueue(sessionId);
  queue.push(point);
  await saveQueue(sessionId, queue);

  const prev = await readStats(sessionId);
  const distanceKm = (prev?.distanceKm || 0) + (prev ? haversineKm({ lat: prev.lastLat, lng: prev.lastLng }, p) : 0);
  await writeStats({ sessionId, distanceKm, pointCount: (prev?.pointCount || 0) + 1, lastLat: p.lat, lastLng: p.lng });
}

// Sends whatever is queued, CHUNK_SIZE at a time, stopping at the first
// failed chunk — everything from there on stays queued for the next
// attempt. Returns false only when a chunk actually failed (never when
// there was simply nothing to send).
export async function flushQueue(sessionId: string): Promise<boolean> {
  let ok = true;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const queue = await loadQueue(sessionId);
    if (queue.length === 0) break;
    const chunk = queue.slice(0, CHUNK_SIZE);
    try {
      await api.post(`/tracking-sessions/${sessionId}/points`, { points: chunk });
    } catch {
      ok = false;
      break;
    }
    const sentIds = new Set(chunk.map((pt) => pt.point_uuid));
    const latest = await loadQueue(sessionId);
    await saveQueue(sessionId, latest.filter((pt) => !sentIds.has(pt.point_uuid)));
  }
  return ok;
}

export async function pendingCount(sessionId: string): Promise<number> {
  return (await loadQueue(sessionId)).length;
}

export async function clearRecording(): Promise<void> {
  await clearQueue();
  await clearLiveStats();
}
