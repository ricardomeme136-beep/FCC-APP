import React, { createContext, useContext, useEffect, useState } from "react";
import { api, TOKEN_KEY } from "@/src/api";
import { storage } from "@/src/utils/storage";

const MANAGEMENT_ROLES = [
  "super_admin",
  "company_admin",
  "dispatcher",
  "operations_manager",
  "maintenance_manager",
];

export type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  company_id: string | null;
  driver_id?: string | null;
  customer_id?: string | null;
  company?: { id: string; name: string } | null;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({} as AuthState);
const USER_KEY = "wf_user";

export function homeForRole(role?: string): string {
  if (!role) return "/login";
  if (role === "driver") return "/(driver)/rota";
  if (role === "customer") return "/(customer)/contentores";
  if (MANAGEMENT_ROLES.includes(role)) return "/(manager)/painel";
  return "/login";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const stored = await storage.getItem<any>(USER_KEY, null);
      const token = await storage.secureGet(TOKEN_KEY, "");
      if (stored && token) {
        setUser(stored);
        // refresh in background
        api.get<User>("/auth/me").then(setUser).catch(() => {});
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post<{ access_token: string; user: User }>("/auth/login", {
      email: email.trim().toLowerCase(),
      password,
    });
    await storage.secureSet(TOKEN_KEY, res.access_token);
    await storage.setItem(USER_KEY, res.user as any);
    setUser(res.user);
  };

  const logout = async () => {
    await storage.secureRemove(TOKEN_KEY);
    await storage.removeItem(USER_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
