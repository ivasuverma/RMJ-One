import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { pickWebFile } from '@/src/components/DocumentCaptureSheet';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { BButton, BCard, BtnType, Header, KIND_LABEL, makeStyles, TplKind } from './_shared';
import { TplPreview } from './_preview';

const TYPE_LABEL: Record<BtnType, string> = { quick_reply: 'Reply', url: 'Website', phone: 'Call' };
const PRESETS: { label: string; buttons: BButton[] }[] = [
  { label: '👍 / 👎', buttons: [{ type: 'quick_reply', text: '👍' }, { type: 'quick_reply', text: '👎' }] },
  { label: 'Interested / Not now', buttons: [{ type: 'quick_reply', text: 'Interested' }, { type: 'quick_reply', text: 'Not now' }] },
  { label: 'Website + Call', buttons: [{ type: 'url', text: 'See designs', url: 'https://rmj.co.in' }, { type: 'phone', text: 'Call the shop', phone: '' }] },
];
const newCard = (type: BtnType): BCard => ({ media_id: '', body: '', button: { type, text: type === 'quick_reply' ? 'Interested' : type === 'url' ? 'See more' : 'Call us', url: type === 'url' ? 'https://rmj.co.in' : undefined } });

type Photo = { id: string; url: string };

async function uploadPhoto(): Promise<Photo | null> {
  const file = await pickWebFile('image/*');
  if (!file) return null;
  const form = new FormData();
  form.append('file', file, file.name || 'photo.jpg');
  return api.upload<Photo>('/broadcasts/media', form);
}

// Template builder: text / photo / scrollable photos (carousel), buttons,
// then submit to Meta for approval (routers/broadcasts.py).
export default function NewTemplateScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<TplKind>('image');
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [buttons, setButtons] = useState<BButton[]>(PRESETS[0].buttons);
  const [cardType, setCardType] = useState<BtnType>('quick_reply');
  const [cards, setCards] = useState<BCard[]>([newCard('quick_reply'), newCard('quick_reply')]);
  const [ack, setAck] = useState('Thank you! We’ll get back to you soon.');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e: any) { toast.error(e?.detail || 'Something went wrong'); } finally { setBusy(null); }
  };

  const setBtn = (i: number, patch: Partial<BButton>) => setButtons((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const setCard = (i: number, patch: Partial<BCard>) => setCards((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setCardBtn = (i: number, patch: Partial<BButton>) => setCards((cs) => cs.map((c, j) => (j === i ? { ...c, button: { ...c.button, ...patch } } : c)));
  const changeCardType = (t: BtnType) => {
    setCardType(t);
    setCards((cs) => cs.map((c) => ({ ...c, button: { ...newCard(t).button, text: c.button.type === t ? c.button.text : newCard(t).button.text } })));
  };
  const addName = () => setBody((b) => (b.includes('{{1}}') ? b : `Dear {{1}}, ${b}`));

  const pickMain = () => run('photo', async () => { const p = await uploadPhoto(); if (p) setPhoto(p); });
  const pickCard = (i: number) => run(`card-${i}`, async () => { const p = await uploadPhoto(); if (p) setCard(i, { media_id: p.id, media_url: p.url }); });

  const hasReply = kind === 'carousel' ? cardType === 'quick_reply' : buttons.some((b) => b.type === 'quick_reply');
  const submit = () => run('submit', async () => {
    await api.post('/broadcasts/templates', {
      label, kind, body, media_id: kind === 'image' ? photo?.id : null,
      buttons: kind === 'carousel' ? [] : buttons,
      cards: kind === 'carousel' ? cards.map(({ media_id, body: b, button }) => ({ media_id, body: b, button })) : [],
      ack_text: hasReply ? ack : '',
    });
    toast.success('Sent to Meta for approval — usually a few minutes to a day');
    router.back();
  });

  // A plain render function, not a component: a component defined in here would
  // remount on every keystroke and the input would lose focus.
  const buttonFields = (b: BButton, onChange: (p: Partial<BButton>) => void, onRemove?: () => void) => (
    <View style={{ gap: 6 }}>
      <View style={styles.row}>
        <TextInput value={b.text} onChangeText={(v) => onChange({ text: v })} maxLength={25} placeholder="Button text" placeholderTextColor={colors.mutedText} style={[styles.input, styles.flex1]} />
        {onRemove && (
          <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove button">
            <Ionicons name="close-circle-outline" size={22} color={colors.mutedText} />
          </Pressable>
        )}
      </View>
      {b.type === 'url' && <TextInput value={b.url || ''} onChangeText={(v) => onChange({ url: v })} autoCapitalize="none" placeholder="https://rmj.co.in/…" placeholderTextColor={colors.mutedText} style={styles.input} />}
      {b.type === 'phone' && <TextInput value={b.phone || ''} onChangeText={(v) => onChange({ phone: v })} keyboardType="phone-pad" placeholder="Phone number" placeholderTextColor={colors.mutedText} style={styles.input} />}
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="broadcast-new-template-screen">
      <Header title="New template" colors={colors} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.small}>Name (only you see this)</Text>
          <TextInput value={label} onChangeText={setLabel} maxLength={60} placeholder="e.g. Diwali bridal offer" placeholderTextColor={colors.mutedText} style={styles.input} testID="tpl-label" />
          <Text style={[styles.small, { marginTop: 6 }]}>Type</Text>
          <View style={styles.chips}>
            {(['text', 'image', 'carousel'] as TplKind[]).map((k) => (
              <Pressable key={k} onPress={() => setKind(k)} style={[styles.chip, kind === k && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: kind === k }} testID={`tpl-kind-${k}`}>
                <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{KIND_LABEL[k]}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {kind === 'image' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Photo</Text>
            {photo && <Image source={{ uri: photo.url }} style={{ width: '100%', aspectRatio: 1.6, borderRadius: 8 }} contentFit="cover" />}
            <Pressable onPress={pickMain} disabled={busy === 'photo'} style={styles.btn} accessibilityRole="button" testID="tpl-photo">
              {busy === 'photo' ? <ActivityIndicator color={colors.brandSecondary} /> : (
                <><Ionicons name="image-outline" size={16} color={colors.brandSecondary} /><Text style={styles.btnText}>{photo ? 'Change photo' : 'Add photo'}</Text></>
              )}
            </Pressable>
            <Text style={styles.hint}>Meta reviews this photo. You can send a different photo later only by making a new template.</Text>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={[styles.cardTitle, styles.flex1]}>Message</Text>
            <Pressable onPress={addName} disabled={body.includes('{{1}}')} style={[styles.chip, body.includes('{{1}}') && { opacity: 0.5 }]} accessibilityRole="button" testID="tpl-add-name">
              <Text style={styles.chipText}>+ Customer name</Text>
            </Pressable>
          </View>
          <TextInput value={body} onChangeText={setBody} multiline maxLength={1024} placeholder="Our new bridal collection is here — visit the shop this week for 10% off making charges."
            placeholderTextColor={colors.mutedText} style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]} testID="tpl-body" />
          <Text style={styles.hint}>{'{{1}}'} is replaced by each customer’s name (or “valued customer”). Keep it promotional and clear — Meta rejects vague or misleading text.</Text>
        </View>

        {kind === 'carousel' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Cards ({cards.length})</Text>
            <Text style={styles.small}>Every card has the same kind of button</Text>
            <View style={styles.chips}>
              {(Object.keys(TYPE_LABEL) as BtnType[]).map((t) => (
                <Pressable key={t} onPress={() => changeCardType(t)} style={[styles.chip, cardType === t && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: cardType === t }}>
                  <Text style={[styles.chipText, cardType === t && styles.chipTextOn]}>{TYPE_LABEL[t]}</Text>
                </Pressable>
              ))}
            </View>
            {cards.map((c, i) => (
              <View key={i} style={[styles.card, { backgroundColor: colors.surface }]} testID={`tpl-card-${i}`}>
                <View style={styles.row}>
                  <Text style={[styles.label, styles.flex1]}>Card {i + 1}</Text>
                  {cards.length > 2 && (
                    <Pressable onPress={() => setCards((cs) => cs.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove card ${i + 1}`}>
                      <Ionicons name="trash-outline" size={18} color={colors.mutedText} />
                    </Pressable>
                  )}
                </View>
                <View style={styles.row}>
                  {c.media_url ? <Image source={{ uri: c.media_url }} style={{ width: 64, height: 64, borderRadius: 8 }} contentFit="cover" /> : null}
                  <Pressable onPress={() => pickCard(i)} disabled={busy === `card-${i}`} style={[styles.btn, styles.flex1]} accessibilityRole="button" testID={`tpl-card-photo-${i}`}>
                    {busy === `card-${i}` ? <ActivityIndicator color={colors.brandSecondary} /> : (
                      <><Ionicons name="image-outline" size={16} color={colors.brandSecondary} /><Text style={styles.btnText}>{c.media_id ? 'Change photo' : 'Add photo'}</Text></>
                    )}
                  </Pressable>
                </View>
                <TextInput value={c.body} onChangeText={(v) => setCard(i, { body: v })} maxLength={160} placeholder="Caption, e.g. Kundan set — 42 g" placeholderTextColor={colors.mutedText} style={styles.input} />
                {buttonFields(c.button, (p) => setCardBtn(i, p))}
              </View>
            ))}
            {cards.length < 10 && (
              <Pressable onPress={() => setCards((cs) => [...cs, newCard(cardType)])} style={styles.btn} accessibilityRole="button" testID="tpl-add-card">
                <Ionicons name="add" size={16} color={colors.brandSecondary} /><Text style={styles.btnText}>Add card</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Buttons ({buttons.length}/3)</Text>
            <View style={styles.chips}>
              {PRESETS.map((p) => (
                <Pressable key={p.label} onPress={() => setButtons(p.buttons)} style={styles.chip} accessibilityRole="button">
                  <Text style={styles.chipText}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
            {buttons.map((b, i) => (
              <View key={i} style={{ gap: 6 }}>
                <View style={styles.chips}>
                  {(Object.keys(TYPE_LABEL) as BtnType[]).map((t) => (
                    <Pressable key={t} onPress={() => setBtn(i, { type: t })} style={[styles.chip, { paddingVertical: 5 }, b.type === t && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: b.type === t }}>
                      <Text style={[styles.chipText, b.type === t && styles.chipTextOn]}>{TYPE_LABEL[t]}</Text>
                    </Pressable>
                  ))}
                </View>
                {buttonFields(b, (p) => setBtn(i, p), () => setButtons((bs) => bs.filter((_, j) => j !== i)))}
              </View>
            ))}
            {buttons.length < 3 && (
              <Pressable onPress={() => setButtons((bs) => [...bs, { type: 'quick_reply', text: '' }])} style={styles.btn} accessibilityRole="button" testID="tpl-add-button">
                <Ionicons name="add" size={16} color={colors.brandSecondary} /><Text style={styles.btnText}>Add button</Text>
              </Pressable>
            )}
            <Text style={styles.hint}>Reply buttons (like 👍 / 👎) are counted for each send. Website and Call open straight from WhatsApp.</Text>
          </View>
        )}

        {hasReply && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Automatic reply to a tap</Text>
            <TextInput value={ack} onChangeText={setAck} maxLength={500} placeholder="Leave empty for no reply" placeholderTextColor={colors.mutedText} style={styles.input} testID="tpl-ack" />
            <Text style={styles.hint}>Sent when a customer taps a reply button. Free — it’s a reply inside their chat.</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Preview</Text>
          <TplPreview kind={kind} body={body} mediaUrl={photo?.url} buttons={buttons} cards={cards} colors={colors} />
        </View>

        <Pressable onPress={submit} disabled={busy === 'submit' || !label.trim() || !body.trim()}
          style={[styles.primary, { marginTop: 16 }, (!label.trim() || !body.trim()) && { opacity: 0.5 }]} testID="tpl-submit" accessibilityRole="button">
          {busy === 'submit' ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Submit to Meta for approval</Text>}
        </Pressable>
        <Text style={styles.hint}>Marketing category — about ₹1.02 per message delivered (incl. GST). Text and buttons can’t be changed after approval; make a new template instead.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
