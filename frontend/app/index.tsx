import { View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth, homeForRole } from "@/src/auth/AuthContext";
import { Loading } from "@/src/components/ui";

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        <Loading text="WASTEFLOW" />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  return <Redirect href={homeForRole(user.role) as any} />;
}
