import { useFonts } from "expo-font";

// Custom brand fonts (bundled locally for reliability).
export const useAppFonts = (): readonly [boolean, Error | null] =>
  useFonts({
    "SpaceGrotesk-Bold": require("../../assets/fonts/SpaceGrotesk-Bold.ttf"),
    "SpaceGrotesk-Medium": require("../../assets/fonts/SpaceGrotesk-Medium.ttf"),
    Mono: require("../../assets/fonts/JetBrainsMono-Regular.ttf"),
    "Mono-Medium": require("../../assets/fonts/JetBrainsMono-Medium.ttf"),
    "Mono-Bold": require("../../assets/fonts/JetBrainsMono-Bold.ttf"),
  });
