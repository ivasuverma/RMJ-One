import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { BackHandler, LogBox, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useIconFonts } from '@/src/hooks/use-icon-fonts';
import { useTextFonts } from '@/src/hooks/use-text-fonts';
import { AuthProvider } from '@/src/auth/AuthContext';
import { ThemeProvider, useTheme } from '@/src/theme/ThemeContext';
import { ErrorBoundary } from '@/src/components/ErrorBoundary';
import { ToastProvider } from '@/src/components/ui/Toast';
import { OfflineBanner } from '@/src/components/OfflineBanner';
import { startUploadQueue } from '@/src/utils/uploadQueue';

// Disable logbox errors etc so that users can see the app and agent works as expected.
LogBox.ignoreAllLogs(true);

// Keep the native splash visible from cold start until icon fonts register.
// Required because @expo/vector-icons' componentDidMount fallback fires
// Font.loadAsync against a broken vendor path if any <Icon> mounts before
// the family is registered — which throws on Android Expo Go.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [textFontsLoaded, textFontsError] = useTextFonts();
  const loaded = iconsLoaded && textFontsLoaded;
  const error = iconsError || textFontsError;

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // If the CDN is unreachable we fall through on error rather than wedging
  // the app — icons will tofu, but the app still boots.
  if (!loaded && !error) return null;

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <SafeAreaProvider>
          <AuthProvider>
            <AppShell />
          </AuthProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function AppShell() {
  const { colors, scheme } = useTheme();
  const router = useRouter();

  // Every screen renders its own in-app back arrow (headerShown is off
  // everywhere), but that doesn't wire up the Android hardware/gesture back
  // button — without this, it falls through to the OS default and minimizes
  // or closes the app instead of popping the screen stack. This makes the
  // hardware button behave the same as tapping the in-app arrow.
  // Register the service worker on web so the app-shell cache + offline
  // tolerance are active even before (or without) enabling push. Safe to call
  // repeatedly — the browser no-ops an already-registered worker.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support just won't activate */ });
    // Resume any document uploads left in the on-device outbox (e.g. the app
    // was closed mid-upload) — they retry automatically in the background.
    startUploadQueue();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (router.canGoBack()) {
        router.back();
        return true;
      }
      return false; // let the OS handle it (minimize) once we're at the root
    });
    return () => sub.remove();
  }, [router]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
      <ToastProvider>
        <View style={{ flex: 1, backgroundColor: colors.surface }}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.surface },
              animation: 'fade',
            }}
          />
          <OfflineBanner />
        </View>
      </ToastProvider>
    </GestureHandlerRootView>
  );
}
