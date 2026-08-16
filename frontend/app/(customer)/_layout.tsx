import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth/AuthContext";
import { colors, fonts, border } from "@/src/theme";
import { Loading } from "@/src/components/ui";

export default function CustomerLayout() {
  const { user, loading } = useAuth();
  const insets = useSafeAreaInsets();
  if (loading) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "customer") return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.onSurface,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: border.width,
          borderTopColor: colors.borderStrong,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom + 5,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 0.5 },
      }}
    >
      <Tabs.Screen name="contentores" options={{ title: "CONTENTORES", tabBarIcon: ({ color, size }) => <Ionicons name="cube" size={size - 2} color={color} /> }} />
      <Tabs.Screen name="recolhas" options={{ title: "RECOLHAS", tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size - 2} color={color} /> }} />
      <Tabs.Screen name="ocorrencias" options={{ title: "OCORRÊNCIAS", tabBarIcon: ({ color, size }) => <Ionicons name="warning" size={size - 2} color={color} /> }} />
    </Tabs>
  );
}
