import { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius, fonts } from '@/src/theme';

type Msg = { id: string; role: 'user' | 'assistant'; text: string };

const SUGGESTIONS = [
  'Who forgot to punch out today?',
  'Which employees are late this week?',
  'What is the total pending payroll?',
  'Which employees have advances outstanding?',
];

export default function AssistantScreen() {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const hist = await api.get<any[]>('/assistant/history?limit=20');
      const msgs: Msg[] = [];
      for (const h of hist.reverse()) {
        msgs.push({ id: `${h.id}-q`, role: 'user', text: h.question });
        msgs.push({ id: `${h.id}-a`, role: 'assistant', text: h.answer });
      }
      setMessages(msgs);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
    } catch (_e) { /* ignore */ }
  }, []);

  useFocusEffect(useCallback(() => { loadHistory(); }, [loadHistory]));

  const ask = async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text || thinking) return;
    setQuestion('');
    const userMsg: Msg = { id: Math.random().toString(36), role: 'user', text };
    setMessages((m) => [...m, userMsg]);
    setThinking(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    try {
      const res = await api.post<{ answer: string }>('/assistant/ask', { question: text });
      setMessages((m) => [...m, { id: Math.random().toString(36), role: 'assistant', text: res.answer }]);
    } catch (e: any) {
      setMessages((m) => [...m, { id: Math.random().toString(36), role: 'assistant', text: `Sorry — ${e?.detail || 'the assistant is unavailable right now.'}` }]);
    } finally {
      setThinking(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="assistant-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>RMJ AI</Text>
          <Text style={styles.subtitle}>Read-only assistant · Gemini 3 Flash</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.lg }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <View style={styles.heroBox}>
              <View style={styles.heroIcon}><Ionicons name="sparkles" size={22} color={colors.onBrandPrimary} /></View>
              <Text style={styles.heroTitle}>Ask me anything about your team.</Text>
              <Text style={styles.heroSub}>I can look up today's attendance, pending approvals, ledger balances, and payroll totals.</Text>

              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s} testID={`suggest-${s.slice(0, 12)}`} onPress={() => ask(s)} style={styles.suggestion}>
                    <Text style={styles.suggestionText}>{s}</Text>
                    <Ionicons name="arrow-forward" size={14} color={colors.brandSecondary} />
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {messages.map((m) => (
            <View key={m.id} style={[styles.msgRow, m.role === 'user' ? styles.msgUser : styles.msgAI]}>
              {m.role === 'assistant' && (
                <View style={styles.aiBadge}><Ionicons name="sparkles" size={12} color={colors.onBrandPrimary} /></View>
              )}
              <Text style={styles.msgText}>{m.text}</Text>
            </View>
          ))}

          {thinking && (
            <View style={[styles.msgRow, styles.msgAI]}>
              <View style={styles.aiBadge}><Ionicons name="sparkles" size={12} color={colors.onBrandPrimary} /></View>
              <ActivityIndicator color={colors.brandPrimary} size="small" />
              <Text style={[styles.msgText, { color: colors.mutedText, marginLeft: spacing.sm }]}>Thinking…</Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.inputRow}>
          <TextInput
            testID="assistant-input"
            value={question} onChangeText={setQuestion}
            placeholder="Ask about attendance, payroll, ledger…"
            placeholderTextColor={colors.mutedText}
            style={styles.input}
            onSubmitEditing={() => ask()}
            returnKeyType="send"
            multiline
          />
          <Pressable
            testID="assistant-send"
            onPress={() => ask()}
            disabled={thinking || !question.trim()}
            style={[styles.sendBtn, (thinking || !question.trim()) && { opacity: 0.4 }]}
            hitSlop={8}
          >
            <Ionicons name="arrow-up" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: {
    color: colors.onSurface, fontSize: 22, fontWeight: '600',
    fontFamily: fonts.display,
  },
  subtitle: { color: colors.brandSecondary, fontSize: 11 },

  heroBox: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
  heroIcon: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: {
    color: colors.onSurface, fontSize: 20, fontWeight: '700', textAlign: 'center',
    fontFamily: fonts.display,
  },
  heroSub: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: 'center', paddingHorizontal: spacing.md },
  suggestions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.lg },
  suggestion: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md,
  },
  suggestionText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13 },

  msgRow: {
    marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, maxWidth: '90%',
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
  },
  msgUser: {
    alignSelf: 'flex-end', backgroundColor: colors.brandPrimary,
  },
  msgAI: {
    alignSelf: 'flex-start', backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
  },
  aiBadge: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  msgText: { color: colors.onSurface, fontSize: 14, flexShrink: 1, lineHeight: 20 },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface,
  },
  input: {
    flex: 1, maxHeight: 100, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 10,
    color: colors.onSurface, fontSize: 14,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
});
