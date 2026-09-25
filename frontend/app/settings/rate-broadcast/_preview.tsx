import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { ThemeColors } from '@/src/theme';
import { BButton, BCard, TplKind } from './_shared';

const ICON: Record<BButton['type'], keyof typeof Ionicons.glyphMap> = {
  quick_reply: 'arrow-undo-outline', url: 'open-outline', phone: 'call-outline',
};

function WaButton({ b }: { b: BButton }) {
  return (
    <View style={s.waButton}>
      <Ionicons name={ICON[b.type]} size={15} color="#1B8AD8" />
      <Text style={s.waButtonText} numberOfLines={1}>{b.text || 'Button'}</Text>
    </View>
  );
}

// What the customer sees in WhatsApp — used by the template builder and the
// template list. {{1}} shows as a sample name.
export function TplPreview({ kind, body, mediaUrl, buttons, cards, colors }: {
  kind: TplKind; body: string; mediaUrl?: string | null; buttons: BButton[]; cards: BCard[]; colors: ThemeColors;
}) {
  const text = (body || 'Your message…').replace(/\{\{1\}\}/g, 'Rahul');
  return (
    <View style={[s.chat, { borderColor: colors.border }]}>
      <View style={s.bubble}>
        {kind === 'image' && (mediaUrl
          ? <Image source={{ uri: mediaUrl }} style={s.photo} contentFit="cover" />
          : <View style={[s.photo, s.empty]}><Ionicons name="image-outline" size={28} color="#8696A0" /></View>)}
        <Text style={s.bubbleText}>{text}</Text>
        {kind !== 'carousel' && buttons.map((b, i) => <WaButton key={i} b={b} />)}
      </View>
      {kind === 'carousel' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 8 }}>
          {cards.map((c, i) => (
            <View key={i} style={[s.bubble, s.card]}>
              {c.media_url
                ? <Image source={{ uri: c.media_url }} style={s.cardPhoto} contentFit="cover" />
                : <View style={[s.cardPhoto, s.empty]}><Ionicons name="image-outline" size={24} color="#8696A0" /></View>}
              <Text style={s.bubbleText} numberOfLines={4}>{c.body || 'Caption'}</Text>
              <WaButton b={c.button} />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  chat: { backgroundColor: '#EFEAE2', borderRadius: 12, padding: 10, borderWidth: 1, marginVertical: 4 },
  bubble: { backgroundColor: '#FFFFFF', borderRadius: 10, overflow: 'hidden', maxWidth: 320, width: '100%' },
  card: { width: 200 },
  photo: { width: '100%', aspectRatio: 1.6, backgroundColor: '#D9DEE2' },
  cardPhoto: { width: '100%', aspectRatio: 1, backgroundColor: '#D9DEE2' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  bubbleText: { color: '#111B21', fontSize: 13.5, lineHeight: 19, padding: 10 },
  waButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D1D7DB' },
  waButtonText: { color: '#1B8AD8', fontSize: 14, fontWeight: '600', flexShrink: 1 },
});
