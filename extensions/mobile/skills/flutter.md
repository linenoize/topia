---
name: "flutter"
pack: "@Topia/mobile"
description: "Flutter patterns — widget composition, state management (Riverpod, BLoC), platform channels, adaptive layouts."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# flutter

Flutter patterns — widget composition, state management (Riverpod, BLoC), platform channels, adaptive layouts.

#### Workflow

**Step 1 — Detect Flutter architecture**
Use Grep to find state management (`riverpod`, `flutter_bloc`, `provider`, `get_it`), routing (`go_router`, `auto_route`), and platform channel usage. Read `pubspec.yaml` for dependencies and `lib/` structure for architecture pattern (feature-first, layer-first).

**Step 2 — Audit widget tree and state**
Check for: `setState` in complex widgets (should use state management), deeply nested widget trees (extract widgets), `BuildContext` passed through many layers (use InheritedWidget or Riverpod), missing `const` constructors (unnecessary rebuilds), platform-specific code without adaptive checks.

**Step 3 — Emit refactored patterns**
For each issue, emit: extracted widget with const constructor, Riverpod provider for state, proper error handling with `AsyncValue`, and adaptive layout using `LayoutBuilder` + breakpoints.

#### Example

```dart
// BEFORE: setState in complex widget, no separation
class HomeScreen extends StatefulWidget { ... }
class _HomeScreenState extends State<HomeScreen> {
  List<Item> items = [];
  bool loading = true;

  @override
  void initState() {
    super.initState();
    fetchItems().then((data) => setState(() { items = data; loading = false; }));
  }
}

// AFTER: Riverpod with AsyncValue, separated concerns
@riverpod
Future<List<Item>> items(Ref ref) async {
  final repo = ref.watch(itemRepositoryProvider);
  return repo.fetchAll();
}

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final itemsAsync = ref.watch(itemsProvider);
    return itemsAsync.when(
      data: (items) => ItemList(items: items),
      loading: () => const ShimmerList(),
      error: (err, stack) => ErrorView(message: err.toString(), onRetry: () => ref.invalidate(itemsProvider)),
    );
  }
}
```
