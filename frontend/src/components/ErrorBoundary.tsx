import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error: Error | null };

// Catches any render-time error anywhere in the app tree that isn't already
// handled locally (a screen throwing while rendering, a bad .map() on
// undefined data, etc.) and shows a recoverable fallback instead of a
// blank/red screen. Deliberately has no dependency on ThemeContext/
// AuthContext — those might be exactly what's broken — so this only needs
// React itself and a few hardcoded colors to render.
//
// Note: like all React error boundaries, this only catches render/lifecycle
// errors in its children, not errors thrown inside event handlers or async
// callbacks (e.g. an onPress's try/catch) — those are already handled
// per-screen via notify(...), which is the right place for them.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Unhandled render error:', error, info?.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.root}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.detail}>
            {this.state.error?.message || 'This screen hit an unexpected error.'}
          </Text>
          <Pressable style={styles.btn} onPress={this.reset} testID="error-boundary-retry">
            <Text style={styles.btnText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#161615', alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { color: '#EDEDEA', fontSize: 20, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  detail: { color: '#A8A29A', fontSize: 13, marginBottom: 28, textAlign: 'center', lineHeight: 19 },
  btn: { backgroundColor: '#C9A24B', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 32 },
  btnText: { color: '#161615', fontWeight: '700', fontSize: 15 },
});
