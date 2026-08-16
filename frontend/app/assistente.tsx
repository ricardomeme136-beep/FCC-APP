import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/Header";
import { Txt } from "@/src/components/ui";
import { colors, fonts, spacing, border } from "@/src/theme";

type Msg = { role: "user" | "ai"; text: string };

export default function Assistente() {
  const insets = useSafeAreaInsets();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => { api.get<{ suggestions: string[] }>("/ai/suggestions").then((r) => setSuggestions(r.suggestions)); }, []);

  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const res = await api.post<{ answer: string }>("/ai/ask", { question: q });
      setMsgs((m) => [...m, { role: "ai", text: res.answer }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "ai", text: "Erro ao contactar o assistente." }]);
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader title="ASSISTENTE IA" subtitle="INTELIGÊNCIA OPERACIONAL" back />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
          {msgs.length === 0 && (
            <View style={styles.intro}>
              <View style={styles.aiMark}><Ionicons name="sparkles" size={24} color={colors.onBrand} /></View>
              <Txt variant="body" color={colors.muted} style={{ textAlign: "center" }}>
                Pergunte sobre a operação de hoje. As respostas baseiam-se nos dados reais da plataforma.
              </Txt>
              <View style={styles.suggWrap}>
                {suggestions.map((s) => (
                  <Pressable key={s} testID={`suggestion-${s.slice(0, 8)}`} style={styles.sugg} onPress={() => send(s)}>
                    <Txt variant="mono" style={{ fontSize: 12 }}>{s}</Txt>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          {msgs.map((m, i) => (
            <View key={i} style={[styles.bubble, m.role === "user" ? styles.user : styles.ai]}>
              <Txt variant={m.role === "user" ? "monoBold" : "mono"} color={m.role === "user" ? "#fff" : colors.onSurface}>{m.text}</Txt>
            </View>
          ))}
          {busy && <View style={[styles.bubble, styles.ai]}><Txt variant="mono" color={colors.muted}>A analisar dados...</Txt></View>}
        </ScrollView>
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <TextInput
            testID="ai-input"
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Escreva a sua pergunta..."
            placeholderTextColor={colors.muted}
            onSubmitEditing={() => send(input)}
          />
          <Pressable testID="ai-send" style={styles.sendBtn} onPress={() => send(input)}>
            <Ionicons name="arrow-up" size={22} color={colors.onBrand} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  intro: { alignItems: "center", gap: spacing.lg, paddingTop: spacing.xl },
  aiMark: { width: 56, height: 56, backgroundColor: colors.brand, borderWidth: border.width, borderColor: colors.border, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  suggWrap: { gap: spacing.sm, width: "100%" },
  sugg: { borderWidth: border.width, borderColor: colors.border, borderRadius: 16, padding: spacing.md, backgroundColor: colors.surfaceSecondary },
  bubble: { padding: spacing.md, borderWidth: border.width, borderColor: colors.border, borderRadius: 16, maxWidth: "90%" },
  user: { alignSelf: "flex-end", backgroundColor: colors.onSurface },
  ai: { alignSelf: "flex-start", backgroundColor: colors.surface },
  inputBar: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderTopWidth: border.width, borderTopColor: colors.borderStrong, alignItems: "center" },
  input: { flex: 1, height: 48, borderWidth: border.width, borderColor: colors.border, borderRadius: 16, paddingHorizontal: spacing.md, fontFamily: fonts.mono, fontSize: 14, color: colors.onSurface },
  sendBtn: { width: 48, height: 48, backgroundColor: colors.brand, borderWidth: border.width, borderColor: colors.border, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
