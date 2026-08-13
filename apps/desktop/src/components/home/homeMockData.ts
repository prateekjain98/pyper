// Presentational-only mock data backing the Wispr Flow-style Home dashboard.
//
// Nothing here is wired to the SQLite transcription history or Convex — the
// arrays are intentionally static so the view can be reviewed for visual parity
// first. Real data (transcription history, streak stats, achievement
// notifications) can replace these exports later without touching the
// presentational components, which only depend on the shapes declared here.

export interface HomeUser {
  /** Short display name rendered in "Welcome back, {name}". */
  name: string;
}

export interface HomeStats {
  /** Consecutive-week dictation streak. */
  streakWeeks: number;
  /** Total words dictated. */
  wordCount: number;
  /** Average words per minute. */
  wpm: number;
}

export interface DictationEntry {
  id: string;
  /** Pre-formatted local time label, e.g. "12:38 PM". */
  time: string;
  /** Dictated text. Empty string renders an intentionally blank row. */
  text: string;
}

export type TipSegmentKind = "text" | "emphasis" | "keycap";

export interface TipSegment {
  kind: TipSegmentKind;
  /** i18n key resolved at render time. */
  key: string;
}

export interface StyleTip {
  id: string;
  /** Serif editorial heading, split into inline-styled segments. */
  heading: TipSegment[];
  /** Body copy, split into inline-styled segments. */
  body: TipSegment[];
  /** i18n key for the call-to-action button label. */
  ctaKey: string;
}

export interface HomeNotification {
  id: string;
  titleKey: string;
  subtitleKey: string;
}

const seg = (kind: TipSegmentKind, key: string): TipSegment => ({ kind, key });

export const HOME_USER: HomeUser = { name: "YX" };

export const HOME_STATS: HomeStats = {
  streakWeeks: 1,
  wordCount: 6343,
  wpm: 12,
};

export const TODAY_HISTORY: DictationEntry[] = [
  {
    id: "h1",
    time: "12:38 PM",
    text: "文件我已经写好了你可以帮我看一下邮件里面的这句话真的没有问题吗",
  },
  { id: "h2", time: "12:26 PM", text: "" },
  { id: "h3", time: "12:20 PM", text: "" },
  { id: "h4", time: "12:16 PM", text: "" },
  { id: "h5", time: "12:15 PM", text: "" },
];

export const STYLE_TIPS: StyleTip[] = [
  {
    id: "sound",
    heading: [
      seg("text", "home.tips.sound.titleLead"),
      seg("emphasis", "home.tips.sound.titleEmphasis"),
    ],
    body: [
      seg("text", "home.tips.sound.bodyLead"),
      seg("emphasis", "home.tips.sound.bodyEmphasis"),
      seg("text", "home.tips.sound.bodyTail"),
    ],
    ctaKey: "home.tips.sound.cta",
  },
  {
    id: "hold",
    heading: [
      seg("text", "home.tips.hold.titleLead"),
      seg("keycap", "home.tips.hold.keycap"),
      seg("text", "home.tips.hold.titleTail"),
    ],
    body: [
      seg("text", "home.tips.hold.bodyLead"),
      seg("emphasis", "home.tips.hold.bodyEmphasis"),
      seg("text", "home.tips.hold.bodyTail"),
    ],
    ctaKey: "home.tips.hold.cta",
  },
];

export const HOME_NOTIFICATIONS: HomeNotification[] = [
  {
    id: "n1",
    titleKey: "home.notifications.items.words5555.title",
    subtitleKey: "home.notifications.items.words5555.subtitle",
  },
  {
    id: "n2",
    titleKey: "home.notifications.items.month1.title",
    subtitleKey: "home.notifications.items.month1.subtitle",
  },
  {
    id: "n3",
    titleKey: "home.notifications.items.words2000.title",
    subtitleKey: "home.notifications.items.words2000.subtitle",
  },
  {
    id: "n4",
    titleKey: "home.notifications.items.words1337.title",
    subtitleKey: "home.notifications.items.words1337.subtitle",
  },
  {
    id: "n5",
    titleKey: "home.notifications.items.weeks2.title",
    subtitleKey: "home.notifications.items.weeks2.subtitle",
  },
];

/** Unread badge count shown on the top-bar notification bell. */
export const NOTIFICATION_UNREAD_COUNT = 1;
