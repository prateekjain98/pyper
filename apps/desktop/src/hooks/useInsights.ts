import { useEffect, useMemo, useState } from "react";
import type { TranscriptionItem } from "../types/electron";
import { useSettingsStore } from "../stores/settingsStore";
import { normalizeDbDate } from "../utils/dateFormatting";

/**
 * Derives the "Your usage" Insights dashboard from local transcription history.
 *
 * Every metric here is REAL, computed from the local DB via `getTranscriptions`:
 *   - total words dictated, dictation count
 *   - words-per-minute (word count / audio duration, averaged) + the number of
 *     recordings that WPM was averaged from
 *   - words corrected (multiset diff of raw_text vs cleaned text)
 *   - dictionary fixes (custom-dictionary term occurrences in dictated text)
 *   - top words dictated (frequency over the dictated text, stop-words removed)
 *   - current + longest day streak, and per-day activity for the heatmap
 *
 * Metrics that can't be derived from what the app tracks (a WPM percentile needs
 * a cross-user population; a per-destination-app breakdown needs the target app,
 * which isn't recorded) are deliberately omitted rather than faked.
 */

const INSIGHTS_FETCH_LIMIT = 100000;
// WPM samples above this are treated as noise (e.g. a 0.2s clip of one word).
const MAX_PLAUSIBLE_WPM = 400;
const MIN_WPM_SAMPLE_MS = 1000;

export interface DayActivity {
  count: number;
  words: number;
}

export interface TopWord {
  /** The dictated word, lower-cased. */
  word: string;
  /** How many times it appears across all dictations. */
  count: number;
  /** Bar width 0–100, scaled to the most frequent word (the top bar fills). */
  barPercent: number;
}

export interface InsightsData {
  isLoading: boolean;
  /** Whether any dictations exist at all. */
  hasData: boolean;

  // ---- all derived from local transcription history ----
  totalWords: number;
  dictationCount: number;
  wpm: number;
  /** False when no transcription carried an audio duration to compute WPM from. */
  wpmAvailable: boolean;
  /** Number of recordings the WPM average was computed from. */
  wpmSampleCount: number;
  wordsCorrected: number;
  dictionaryFixes: number;
  fixesTotal: number;
  /** Most-dictated words (stop-words removed), highest first. */
  topWords: TopWord[];
  /** Distinct non-trivial words dictated overall. */
  distinctWordCount: number;
  currentStreak: number;
  longestStreak: number;
  /** Keyed by local-calendar day index (see `dayIndexFromLocalDate`). */
  activityByDay: Map<number, DayActivity>;
  todayIndex: number;
}

/** A stable integer id for a local calendar day (days since the Unix epoch). */
export function dayIndexFromLocalDate(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

/** The {year, month, day} of a day index — inverse of `dayIndexFromLocalDate`. */
export function partsFromDayIndex(index: number): { year: number; month: number; day: number } {
  const d = new Date(index * 86400000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Multiset difference: how many words in `finalText` aren't accounted for in
 * `rawText`. A bounded, order-insensitive proxy for how many words Pyper's
 * cleanup added or changed (real, derived from raw_text vs the cleaned text).
 */
function correctedWordCount(rawText: string, finalText: string): number {
  const rawBag = new Map<string, number>();
  for (const w of tokenize(rawText)) rawBag.set(w, (rawBag.get(w) ?? 0) + 1);
  let changed = 0;
  for (const w of tokenize(finalText)) {
    const remaining = rawBag.get(w) ?? 0;
    if (remaining > 0) rawBag.set(w, remaining - 1);
    else changed++;
  }
  return changed;
}

// Number of top words surfaced in the "Top words" card.
const TOP_WORDS_LIMIT = 6;
// Ensure even the least-frequent surfaced word keeps a visible bar.
const MIN_BAR_PERCENT = 6;

// Common function/filler words filtered out so "top words" reflects what the
// user actually dictates about, not "the / and / to". English-focused (the bulk
// of dictation); non-English function words may still surface, which is honest —
// they're real words the user dictated.
const STOP_WORDS = new Set<string>([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "so", "as", "of",
  "at", "by", "for", "with", "about", "into", "through", "to", "from", "up",
  "down", "in", "out", "on", "off", "over", "under", "again", "is", "are",
  "was", "were", "be", "been", "being", "am", "do", "does", "did", "doing",
  "have", "has", "had", "having", "i", "me", "my", "mine", "we", "our", "us",
  "you", "your", "yours", "he", "she", "it", "they", "them", "him", "his",
  "her", "its", "their", "this", "that", "these", "those", "there", "here",
  "than", "too", "very", "can", "will", "just", "not", "no", "yes", "would",
  "should", "could", "also", "get", "got", "going", "gonna", "wanna", "like",
  "um", "uh", "okay", "ok", "yeah", "hey", "well", "really", "actually", "want",
  "need", "know", "think", "one", "some", "any", "all", "what", "which", "who",
  "when", "where", "why", "how", "im", "dont", "its", "thats", "youre", "were",
  "ive", "cant", "wont", "didnt", "doesnt", "isnt", "lets",
  "i'm", "don't", "it's", "that's", "you're", "we're", "they're", "i've",
  "can't", "won't", "didn't", "doesn't", "isn't", "aren't", "i'll", "let's",
]);

function emptyInsights(todayIndex: number, isLoading: boolean): InsightsData {
  return {
    isLoading,
    hasData: false,
    totalWords: 0,
    dictationCount: 0,
    wpm: 0,
    wpmAvailable: false,
    wpmSampleCount: 0,
    wordsCorrected: 0,
    dictionaryFixes: 0,
    fixesTotal: 0,
    topWords: [],
    distinctWordCount: 0,
    currentStreak: 0,
    longestStreak: 0,
    activityByDay: new Map(),
    todayIndex,
  };
}

export function useInsights(): InsightsData {
  const [items, setItems] = useState<TranscriptionItem[] | null>(null);
  const customDictionary = useSettingsStore((s) => s.customDictionary);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await window.electronAPI?.getTranscriptions?.(INSIGHTS_FETCH_LIMIT, {
          includeDiscarded: false,
        });
        if (!cancelled) setItems(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo<InsightsData>(() => {
    const todayIndex = dayIndexFromLocalDate(new Date());
    if (items === null) return emptyInsights(todayIndex, true);
    if (items.length === 0) return emptyInsights(todayIndex, false);

    const dictionaryTerms = (customDictionary ?? [])
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term.length > 0);

    let totalWords = 0;
    let wordsCorrected = 0;
    let dictionaryFixes = 0;
    let wpmSum = 0;
    let wpmSamples = 0;
    const activityByDay = new Map<number, DayActivity>();
    const wordFreq = new Map<string, number>();

    for (const item of items) {
      const text = item.text ?? "";
      const words = countWords(text);
      totalWords += words;

      // Word frequency for the "Top words" card (stop-words + 1-char tokens out).
      if (text) {
        for (const token of tokenize(text)) {
          if (token.length < 2 || STOP_WORDS.has(token)) continue;
          wordFreq.set(token, (wordFreq.get(token) ?? 0) + 1);
        }
      }

      // Words corrected — only when a distinct raw transcript exists to compare.
      if (item.raw_text && item.raw_text !== text) {
        wordsCorrected += correctedWordCount(item.raw_text, text);
      }

      // Dictionary fixes — occurrences of custom-dictionary terms in the output.
      if (dictionaryTerms.length > 0 && text) {
        const lower = text.toLowerCase();
        for (const term of dictionaryTerms) {
          let from = 0;
          for (;;) {
            const idx = lower.indexOf(term, from);
            if (idx === -1) break;
            dictionaryFixes++;
            from = idx + term.length;
          }
        }
      }

      // WPM — word count over the recording's audio duration.
      const ms = item.audio_duration_ms ?? 0;
      if (ms >= MIN_WPM_SAMPLE_MS && words > 0) {
        const wpm = words / (ms / 60000);
        if (wpm > 0 && wpm <= MAX_PLAUSIBLE_WPM) {
          wpmSum += wpm;
          wpmSamples++;
        }
      }

      // Per-day activity for the streak + heatmap.
      const date = normalizeDbDate(item.timestamp || item.created_at);
      if (!Number.isNaN(date.getTime())) {
        const dayIdx = dayIndexFromLocalDate(date);
        const entry = activityByDay.get(dayIdx) ?? { count: 0, words: 0 };
        entry.count += 1;
        entry.words += words;
        activityByDay.set(dayIdx, entry);
      }
    }

    // Streaks over the set of active calendar days.
    const activeDays = [...activityByDay.keys()].sort((a, b) => a - b);
    let longestStreak = 0;
    let run = 0;
    let prev: number | null = null;
    for (const day of activeDays) {
      run = prev !== null && day === prev + 1 ? run + 1 : 1;
      if (run > longestStreak) longestStreak = run;
      prev = day;
    }
    // Current streak counts back from today (or yesterday, so a day not yet
    // dictated into doesn't instantly zero an ongoing streak).
    let currentStreak = 0;
    let cursor = activityByDay.has(todayIndex) ? todayIndex : todayIndex - 1;
    while (activityByDay.has(cursor)) {
      currentStreak++;
      cursor--;
    }

    const wpmAvailable = wpmSamples > 0;
    const wpm = wpmAvailable ? Math.round(wpmSum / wpmSamples) : 0;

    // Top words, most frequent first, bar widths scaled to the leader.
    const ranked = [...wordFreq.entries()].sort((a, b) => b[1] - a[1]);
    const topCount = ranked.length > 0 ? ranked[0][1] : 0;
    const topWords: TopWord[] = ranked.slice(0, TOP_WORDS_LIMIT).map(([word, count]) => ({
      word,
      count,
      barPercent:
        topCount > 0 ? Math.max(MIN_BAR_PERCENT, Math.round((count / topCount) * 100)) : 0,
    }));

    return {
      isLoading: false,
      hasData: true,
      totalWords,
      dictationCount: items.length,
      wpm,
      wpmAvailable,
      wpmSampleCount: wpmSamples,
      wordsCorrected,
      dictionaryFixes,
      fixesTotal: wordsCorrected + dictionaryFixes,
      topWords,
      distinctWordCount: wordFreq.size,
      currentStreak,
      longestStreak,
      activityByDay,
      todayIndex,
    };
  }, [items, customDictionary]);
}
