import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomTabBar } from "@react-navigation/bottom-tabs";
import { useAuth } from "@/src/auth/AuthContext";
import { colors, fonts, border } from "@/src/theme";
import { Loading } from "@/src/components/ui";
import Sidebar from "@/src/components/Sidebar";

const MANAGEMENT = ["super_admin", "company_admin", "dispatcher", "operations_manager", "maintenance_manager"];
const DESKTOP_BREAKPOINT = 768;

export default function ManagerLayout() {
  const { user, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  if (loading) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  if (!MANAGEMENT.includes(user.role)) return <Redirect href="/" />;

  return (
    <Tabs
      tabBar={(props) => (isDesktop ? <Sidebar {...props} /> : <BottomTabBar {...props} />)}
      screenOptions={{
        headerShown: false,
        tabBarPosition: isDesktop ? "left" : "bottom",
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: border.width,
          borderTopColor: colors.divider,
          height: 58 + insets.bottom,
          paddingBottom: insets.bottom + 4,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: fonts.monoBold, fontSize: 9, letterSpacing: 0.5 },
      }}
    >
      <Tabs.Screen name="painel" options={{ title: "PAINEL", tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size - 2} color={color} /> }} />
      <Tabs.Screen name="mapa" options={{ title: "MAPA", tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size - 2} color={color} /> }} />
      <Tabs.Screen name="rotas" options={{ title: "ROTAS", tabBarIcon: ({ color, size }) => <Ionicons name="navigate" size={size - 2} color={color} /> }} />
      <Tabs.Screen name="contentores" options={{ title: "CONTENTORES", tabBarIcon: ({ color, size }) => <Ionicons name="cube" size={size - 2} color={color} /> }} />
      <Tabs.Screen name="mais" options={{ title: "MAIS", tabBarIcon: ({ color, size }) => <Ionicons name="menu" size={size - 2} color={color} /> }} />
    </Tabs>
  );
}
