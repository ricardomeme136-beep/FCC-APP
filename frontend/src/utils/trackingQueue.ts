// Persistent offline queue for GRAVAR TRAJETO GPS points (FASE TRACK 2).
// Backed by AsyncStorage (disk, not memory) so points captured while the
// phone has no signal survive the app being backgrounded or killed and
// relaunched — the in-memory-only queue from FASE TRACK 1 lost everything
// on a kill. Cleared only after the backend confirms a 2xx for that chunk
// (see flush() in app/(driver)/gravar.tsx), never optimistically.
import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_KEY = "wf_tracking_queue_v1";

export type QueuedPoint = {
  point_uuid: string; lat: number; lng: number; timestamp: string;
  speed?: number; heading?: number; accuracy?: number; altitude?: number;
};

type QueueState = { sessionId: string; points: QueuedPoint[] };

// Points from a PREVIOUS recording never leak into a new one — a stale
// queue for a session_id that isn't the one being resumed is simply
// dropped (that recording is over; the backend already has whatever it
// received before the point_uuid index would make replaying it harmless
// anyway, but there is nothing meaningful left to send it to).
export async function loadQueue(sessionId: string): Promise<QueuedPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const state: QueueState = JSON.parse(raw);
    return state.sessionId === sessionId ? state.points : [];
  } catch {
    return [];
  }
}

export async function saveQueue(sessionId: string, points: QueuedPoint[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify({ sessionId, points } as QueueState));
  } catch {
    // Best-effort persistence — if disk write fails the points are still
    // safe in the in-memory ref for this app lifetime, just not across a kill.
  }
}

export async function clearQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUEUE_KEY);
  } catch {}
}
