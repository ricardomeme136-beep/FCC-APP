import { storage } from "@/src/utils/storage";

const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;
export const TOKEN_KEY = "wf_token";

if (__DEV__) {
  // "localhost"/"127.0.0.1" only resolves to the device itself — on a
  // physical phone via Expo Go that's never your PC. Catches the exact
  // misconfiguration class that produced a silent "Load failed" on every
  // request, right at startup instead of after a confusing first failure.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(BASE)) {
    console.warn(
      `[api] EXPO_PUBLIC_BACKEND_URL is "${process.env.EXPO_PUBLIC_BACKEND_URL}" — this only works ` +
      `for web or an emulator. On a physical device, set it to your PC's LAN IP in frontend/.env ` +
      `and restart "expo start" (env vars are baked into the bundle, a reload isn't enough).`
    );
  } else {
    console.log(`[api] backend: ${BASE}`);
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await storage.secureGet(TOKEN_KEY, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (err: any) {
    // fetch() itself threw — the request never reached the server (host
    // unreachable, no network, wrong EXPO_PUBLIC_BACKEND_URL for a physical
    // device, etc). There's no HTTP response to inspect here, so this is
    // handled separately from the !res.ok branch below.
    if (__DEV__) {
      console.warn(`[api] network failure calling ${url}:`, err?.message || err);
    }
    throw new ApiError("Não foi possível ligar ao servidor. Verifica a tua ligação.", 0);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || `Erro ${res.status}`;
    throw new ApiError(typeof detail === "string" ? detail : JSON.stringify(detail), res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: any) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: any) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string, body?: any) =>
    request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
};
