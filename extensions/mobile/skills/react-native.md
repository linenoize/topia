---
name: "react-native"
pack: "@Topia/mobile"
description: "React Native patterns — New Architecture migration, navigation, state management, native modules, performance optimization, Expo vs bare workflow decisions."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# react-native

React Native patterns — New Architecture migration, navigation, state management, native modules, performance optimization, Expo vs bare workflow decisions.

#### Workflow

**Step 1 — Detect React Native setup**
Use Grep to find framework markers: `react-native` in package.json (extract version — 0.82+ = New Architecture mandatory), `expo` config (extract SDK version — 53+ = New Arch default), navigation library (`@react-navigation/native` v6 vs v7, `expo-router` v3 vs v4), state management (`zustand`, `redux`, `jotai`), and native module usage. Read `app.json`/`app.config.js` for Expo configuration.

**Step 2 — Audit New Architecture readiness**
Check for:
- `react-native` >= 0.82 or Expo SDK >= 55: New Architecture is mandatory, no opt-out
- `setNativeProps` usage: incompatible with New Architecture, must migrate to Reanimated or Animated API
- Third-party libraries using legacy Bridge (`NativeModules.X` directly instead of TurboModules): check each against `reactnative.directory` compatibility list
- `react-native-reanimated` version: must be >= 3.8 to avoid Android animation stutter on New Architecture (GitHub #7435)
- Kotlin version in `android/build.gradle`: Reanimated + Kotlin 1.9.25 fails EAS Build (GitHub #7674)
- State batching: New Architecture enables React 18 concurrent batching — components relying on intermediate state between updates silently break

**Step 3 — Audit performance patterns**
Check for: FlatList without `keyExtractor` or with inline `renderItem` (re-renders), images using `react-native-fast-image` (not compatible with New Architecture — migrate to `expo-image`), heavy re-renders from context (missing `useMemo`/`useCallback`), navigation listeners not cleaned up, large JS bundle without lazy loading (`React.lazy` + `Suspense`), `removeClippedSubviews` causing blank cells on fast scroll.

**Step 4 — Audit navigation patterns (React Navigation v7 / Expo Router v4)**
Check for:
- `navigate()` calls: v7 changed semantics — now pushes new screen even if route exists in stack (v6 navigated to existing instance). Audit all `navigation.navigate()` calls
- `useNavigation()` hook: causes re-renders on every route change in Expo Router v4, not just current route (GitHub #35383). Replace with `useRouter()` for navigation-only usage
- Non-unique navigator names: deep links silently fail to resolve (GitHub #9267)
- Authentication + deep link race condition: `NavigationContainer` not ready when initial URL received. Must capture URL, wait for auth, then navigate

**Step 5 — Emit optimized patterns**
For each issue, emit the fix: memoized FlatList item components, `expo-image` migration, proper navigation with typed routes, optimized state selectors, and Hermes engine configuration. For New Architecture migration, emit a phased plan: audit → update libraries → enable → test → fix regressions.

#### Example

```tsx
// BEFORE: FlatList anti-patterns + legacy image library
import FastImage from 'react-native-fast-image'; // ❌ Not New Arch compatible
<FlatList
  data={items}
  renderItem={({ item }) => (
    <View>
      <FastImage source={{ uri: item.image }} />
      <Text>{item.name}</Text>
    </View>
  )}
/>

// AFTER: New Architecture compatible, memoized, proper image caching
import { Image } from 'expo-image'; // ✅ New Arch compatible
import { FlashList } from '@shopify/flash-list'; // ✅ Better than FlatList

const ItemCard = React.memo<{ item: Item; onPress: () => void }>(({ item, onPress }) => (
  <Pressable onPress={onPress}>
    <Image
      source={item.image}
      style={styles.image}
      contentFit="cover"
      placeholder={item.blurhash}
      transition={200}
    />
    <Text>{item.name}</Text>
  </Pressable>
));

const renderItem = useCallback(({ item }: { item: Item }) => (
  <ItemCard item={item} onPress={() => router.push(`/product/${item.id}`)} />
), [router]);

<FlashList
  data={items}
  renderItem={renderItem}
  estimatedItemSize={88} // Required — measure actual item height
  keyExtractor={item => item.id}
/>
```
