// Loads "Jost" — a free, open geometric sans that reads very close to Century
// Gothic (same rounded, humanist-geometric letterforms) — from a CDN, the
// same way use-icon-fonts.ts loads icon glyphs. That workaround exists
// because bundling .ttf files locally and `require()`-ing them hits a
// Metro/Android asset-resolution bug under Expo Go that returns 0-byte font
// files; loading from CDN under Expo Go sidesteps it. We deliberately don't
// add a @expo-google-fonts/* npm dependency (same constraint noted in
// theme.ts) — native/prod builds and web simply fall back to the closest
// built-in system font referenced in theme.ts, since an unregistered font
// family name is a silent no-op in React Native rather than a crash.
// Usage: const [loaded, error] = useTextFonts();

import Constants, { ExecutionEnvironment } from "expo-constants";
import { useFonts } from "expo-font";

const JOST_VERSION = "0.4.2";

const cdnUrl = (file: string): string =>
  `https://cdn.jsdelivr.net/npm/@expo-google-fonts/jost@${JOST_VERSION}/${file}`;

const TEXT_FONT_MAP: Record<string, string> = {
  "Jost-Regular": cdnUrl("Jost_400Regular.ttf"),
  "Jost-Medium": cdnUrl("Jost_500Medium.ttf"),
  "Jost-SemiBold": cdnUrl("Jost_600SemiBold.ttf"),
  "Jost-Bold": cdnUrl("Jost_700Bold.ttf"),
};

export const useTextFonts = (): readonly [boolean, Error | null] =>
  useFonts(
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
      ? TEXT_FONT_MAP
      : {},
  );
