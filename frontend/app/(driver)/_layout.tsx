import { useEffect } from "react";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth/AuthContext";
import { api } from "@/src/api";
import { colors, fonts, border } from "@/src/theme";
import { Loading } from "@/src/components/ui";

const HEARTBEAT_INTERVAL_MS = 45_000;

export default function DriverLayout() {
  const { user, loading } = useAuth();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!user || user.role !== "driver") return;
    const send = () => { api.post("/drivers/me/heartbeat", {}).catch(() => {}); };
    send();
    const t = setInterval(send, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(t);
  }, [user]);

  if (loading) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "driver") return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: border.width,
          borderTopColor: colors.divider,
          height: 64 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontFamily: fonts.monoBold, fontSize: 11, letterSpacing: 0.5 },
      }}
    >
      <Tabs.Screen name="rota" options={{ title: "A MINHA ROTA", tabBarIcon: ({ color, size }) => <Ionicons name="navigate" size={size} color={color} /> }} />
      <Tabs.Screen name="recolhas" options={{ title: "RECOLHAS", tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} /> }} />
      <Tabs.Screen name="gravar" options={{ title: "GRAVAR", tabBarIcon: ({ color, size }) => <Ionicons name="radio-button-on" size={size} color={color} /> }} />
      <Tabs.Screen name="perfil" options={{ title: "PERFIL", tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} /> }} />
    </Tabs>
  );
}
