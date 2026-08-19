// Not cryptographically secure — fine here, since the only requirement for a
// point_uuid (the tracking batch idempotency key, see backend/routers/
// tracking.py) is "practically never collides", not unpredictability. No
// extra dependency needed (expo-crypto / react-native-get-random-values
// aren't installed).
export function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
