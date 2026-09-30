import { ReactNode, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, ScrollView, View } from 'react-native';

/**
 * A news-channel style ticker: the row slides continuously and loops without a seam
 * (it renders the row twice and slides by one row's width). Touching it pauses the
 * slide so an item can be tapped. With Reduce Motion on, it's a plain swipeable row.
 */
export function Marquee({ children, speed = 32, gap = 8, testID }: { children: ReactNode; speed?: number; gap?: number; testID?: string }) {
  const [rowW, setRowW] = useState(0);
  const [boxW, setBoxW] = useState(0);
  const [still, setStill] = useState(false);
  const x = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setStill(!!v); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const start = () => {
    if (!rowW || still) return;
    anim.current?.stop();
    // Carry on from wherever it paused, at the same speed.
    x.stopAnimation((cur) => {
      const from = ((cur % rowW) - rowW) % rowW;   // (-rowW, 0]
      x.setValue(from);
      const first = Animated.timing(x, { toValue: -rowW, duration: ((rowW + from) / speed) * 1000, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' });
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(x, { toValue: -rowW, duration: (rowW / speed) * 1000, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }),
      ]));
      anim.current = Animated.sequence([first, loop]);
      anim.current.start();
    });
  };
  const pause = () => { anim.current?.stop(); };

  useEffect(() => { start(); return pause; }, [rowW, still]); // eslint-disable-line react-hooks/exhaustive-deps

  if (still) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap }} testID={testID}>{children}</ScrollView>
    );
  }
  // Enough copies to always cover the width while one slides out.
  const copies = rowW && boxW ? Math.max(2, Math.ceil(boxW / rowW) + 1) : 2;
  return (
    <View style={{ overflow: 'hidden' }} onLayout={(e) => setBoxW(e.nativeEvent.layout.width)} testID={testID}
      onTouchStart={pause} onTouchEnd={start} onTouchCancel={start}
      {...(Platform.OS === 'web' ? { onMouseEnter: pause, onMouseLeave: start } as any : {})}>
      <Animated.View style={{ flexDirection: 'row', alignSelf: 'flex-start', transform: [{ translateX: x }] }}>
        {Array.from({ length: copies }).map((_, i) => (
          <View key={i} style={{ flexDirection: 'row', gap, paddingRight: gap, flexShrink: 0 }}
            onLayout={i === 0 ? (e) => setRowW(Math.round(e.nativeEvent.layout.width)) : undefined}
            accessibilityElementsHidden={i > 0} importantForAccessibility={i > 0 ? 'no-hide-descendants' : 'auto'}>
            {children}
          </View>
        ))}
      </Animated.View>
    </View>
  );
}
