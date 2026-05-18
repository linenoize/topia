---
name: "video-repurpose"
pack: "@Topia/content"
description: "Long-form video → short-form clip pipeline. Transcribe, identify viral segments, reformat to vertical (9:16), add animated captions, insert B-roll."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# video-repurpose

Long-form video → short-form clip pipeline. Transcribe, identify viral segments, reformat to vertical (9:16), add animated captions, insert B-roll. Covers the full pipeline from YouTube URL or file upload to platform-ready export.

#### Workflow

**Step 1 — Ingest source video**
Two paths:
- URL: Use `yt-dlp` to download (with exponential backoff, browser-mimicking headers for anti-bot):
  ```bash
  yt-dlp -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" \
    --merge-output-format mp4 \
    --retry-sleep 5 --retries 3 \
    -o "source_%(id)s.%(ext)s" "<url>"
  ```
- File upload: Validate format (mp4/mov/webm), check duration (warn if > 2 hours — processing time scales non-linearly)

Cache key: `sha256(source_type|processing_mode|url_or_hash)` — avoid reprocessing same video.

**Step 2 — Transcribe with word-level timestamps**
Use AssemblyAI (97%+ accuracy, 20+ languages) or Whisper (self-hosted):
```typescript
interface WordTimestamp {
  text: string;
  start: number;  // milliseconds
  end: number;
  confidence: number;
}

interface Transcript {
  words: WordTimestamp[];
  text: string;
  language: string;
  duration: number;
}
```
Sharp edge: Whisper `large-v3` halluccinates on silence — preprocess with silence detection and split audio at gaps > 2s.

**Step 3 — Identify viral segments via LLM**
Send transcript to LLM with structured output schema:
```typescript
interface ViralSegment {
  startMs: number;
  endMs: number;
  hookType: 'question' | 'statement' | 'statistic' | 'story' | 'contrast';
  title: string;
  score: ViralityScore;
  bRollOpportunities: Array<{ timestampMs: number; query: string }>;
}

interface ViralityScore {
  hookStrength: number;   // 0-25: first 3 seconds grab attention?
  engagement: number;     // 0-25: keeps viewer watching?
  value: number;          // 0-25: teaches or entertains?
  shareability: number;   // 0-25: would viewer share this?
  total: number;          // 0-100
}
```

Filters:
- Discard segments < 5 seconds or < 3 words
- Recalculate total if subscores don't add up (LLM math errors)
- Sort by total score, return top 3-7 segments per video

**Step 4 — Reformat to vertical (9:16) with face-centered crop**
Triple-fallback face detection for crop anchor:
1. **MediaPipe** (fastest, most accurate for single face)
2. **OpenCV DNN** (good for multiple faces)
3. **Haar cascade** (last resort, highest false positive rate)

Temporal consistency: filter out detection jumps > 20% frame width between consecutive frames (false positives). Smooth crop position with rolling average (5 frames) to avoid jitter.

Fast path: if clip needs no captions or crop changes, use ffmpeg stream copy (no re-encoding) for 10x speed.

**Step 5 — Add animated captions**
Word-synchronized captions from transcript timestamps. Template system:
| Template | Style | Use Case |
|----------|-------|----------|
| `bold-highlight` | Active word in accent color, bold | Educational content |
| `karaoke` | Word-by-word reveal, green highlight | Motivational, podcast |
| `subtitle` | Bottom-center, semi-transparent bg | Professional, interview |
| `pop` | Scale animation on each word | Energetic, entertainment |

Caption rendering: pre-render text as image overlays (MoviePy TextClip or Pillow), composite onto video at word timestamps.

**Step 6 — Insert B-roll (optional)**
Search stock footage API (Pexels) for AI-identified insertion points:
```typescript
async function findBRoll(query: string, orientation: 'portrait' | 'landscape'): Promise<StockClip> {
  const results = await pexels.videos.search({ query, orientation, per_page: 5 });
  // Score by: duration match, HD quality, relevance
  return results.videos
    .map(v => ({ ...v, score: scoreBRoll(v, targetDuration) }))
    .sort((a, b) => b.score - a.score)[0];
}
```
Composite with crossfade transition (0.5s) at identified timestamps.

**Step 7 — Export with platform presets**
| Platform | Aspect | Max Duration | Resolution | Codec |
|----------|--------|-------------|------------|-------|
| TikTok | 9:16 | 10 min | 1080×1920 | H.264 |
| Instagram Reels | 9:16 | 90s | 1080×1920 | H.264 |
| YouTube Shorts | 9:16 | 60s | 1080×1920 | H.264 |
| Twitter/X | 16:9 or 1:1 | 2m20s | 1280×720 | H.264 |

#### Example

```typescript
// Complete pipeline orchestration
async function repurposeVideo(sourceUrl: string, options: RepurposeOptions): Promise<Clip[]> {
  // Step 1: Ingest
  const cacheKey = sha256(`url|${options.mode}|${sourceUrl}`);
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const sourcePath = await downloadVideo(sourceUrl);

  // Step 2: Transcribe
  const transcript = await transcribe(sourcePath, { model: options.mode === 'fast' ? 'nano' : 'default' });

  // Step 3: Identify segments
  const segments = await identifyViralSegments(transcript, {
    minDuration: 10_000,
    maxDuration: 60_000,
    maxSegments: 7,
  });

  // Step 4-6: Process each segment in parallel
  const clips = await Promise.all(
    segments.map(async (segment) => {
      const raw = await extractSegment(sourcePath, segment.startMs, segment.endMs);
      const vertical = await cropToVertical(raw, { faceDetection: true });
      const captioned = await addCaptions(vertical, transcript.words, segment, options.captionTemplate);
      const withBRoll = options.bRoll
        ? await insertBRoll(captioned, segment.bRollOpportunities)
        : captioned;
      return { ...segment, outputPath: withBRoll };
    })
  );

  await cache.set(cacheKey, clips);
  return clips;
}
```
