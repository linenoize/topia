---
name: "native-bridge"
pack: "@Topia/mobile"
description: "Native bridge patterns — platform-specific code, Expo Modules API, TurboModules, Swift/Kotlin interop, background tasks."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# native-bridge

Native bridge patterns — platform-specific code, Expo Modules API, TurboModules, Swift/Kotlin interop, background tasks.

#### Workflow

**Step 1 — Detect bridge requirements**
Use Grep to find platform-specific code: `Platform.OS`, `Platform.select`, `NativeModules` (legacy), `TurboModuleRegistry` (new), `MethodChannel` (Flutter), Expo modules (`expo-modules-core`). Read existing native code in `ios/` and `android/` directories.

**Step 2 — Audit bridge safety**
Check for:
- `NativeModules.X` direct access: returns `undefined` silently in bridgeless mode (New Architecture). Must use TurboModule codegen or Expo Modules API instead
- Type mismatches between JS/Dart and native (string expected, int sent): crashes app instead of returning error
- Synchronous bridge calls blocking UI thread
- Missing null checks on platform-specific returns
- Mixing old Bridge modules + new TurboModules: possible during migration but causes subtle memory leaks
- Missing codegen step (`generateCodegenArtifacts`): intermittent "module not found" errors only in release builds

**Step 3 — Emit type-safe bridge**
For React Native: emit Expo Module with TypeScript interface (preferred) or TurboModule with codegen types. For Flutter: emit MethodChannel with proper error handling, type-safe serialization, and platform-specific implementations for both iOS (Swift) and Android (Kotlin).

#### Example

```typescript
// React Native — Expo Module (type-safe, New Architecture compatible)
// modules/haptics/index.ts
import { NativeModule, requireNativeModule } from 'expo-modules-core';

interface HapticsModule extends NativeModule {
  impact(style: 'light' | 'medium' | 'heavy'): void;
  notification(type: 'success' | 'warning' | 'error'): void;
}

const HapticsNative = requireNativeModule<HapticsModule>('Haptics');

export function impact(style: 'light' | 'medium' | 'heavy' = 'medium') {
  HapticsNative.impact(style);
}

// modules/haptics/ios/HapticsModule.swift
import ExpoModulesCore
import UIKit

public class HapticsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Haptics")
    Function("impact") { (style: String) in
      let generator: UIImpactFeedbackGenerator
      switch style {
      case "light": generator = UIImpactFeedbackGenerator(style: .light)
      case "heavy": generator = UIImpactFeedbackGenerator(style: .heavy)
      default: generator = UIImpactFeedbackGenerator(style: .medium)
      }
      generator.impactOccurred()
    }
  }
}
```
