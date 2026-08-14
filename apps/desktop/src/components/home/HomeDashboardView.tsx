import { useTranslation } from "react-i18next";
import type { TranscriptionItem as TranscriptionItemType } from "../../types/electron";
import { useAuth } from "../../hooks/useAuth";
import { useInsights } from "../../hooks/useInsights";
import HistoryView from "../HistoryView";
import WelcomeStats from "./WelcomeStats";
import StyleTipCard from "./StyleTipCard";
import { STYLE_TIPS } from "./homeMockData";

interface HomeDashboardViewProps {
  history: TranscriptionItemType[];
  isLoading: boolean;
  hotkey: string;
  showCloudMigrationBanner: boolean;
  setShowCloudMigrationBanner: (show: boolean) => void;
  aiCTADismissed: boolean;
  setAiCTADismissed: (dismissed: boolean) => void;
  useCleanupModel: boolean;
  copyToClipboard: (text: string) => void;
  deleteTranscription: (id: number) => void;
  clearAllTranscriptions: () => void;
  onOpenSettings: (section?: string) => void;
  onShowAudioInFolder: (id: number) => void;
  onRetryTranscription: (id: number, options?: { isRecover?: boolean }) => Promise<void>;
  showDiscarded: boolean;
  onToggleDiscarded: () => void;
}

/**
 * The Home view: the Wispr Flow-style dashboard hero (welcome + live usage
 * stats + rotating style tip) mounted above the existing, fully-functional
 * transcription HistoryView. Keeps the app's real sidebar/nav and every
 * per-item action — only the header region is new.
 *
 * Greeting and stats are wired to live data (useAuth + useInsights, the same
 * source the Insights view uses); the HistoryView below remains the source of
 * truth for the dictation list (grouped "Today / Yesterday / …").
 */
export default function HomeDashboardView(props: HomeDashboardViewProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const insights = useInsights();

  const name =
    user?.name?.trim().split(/\s+/)[0] ||
    user?.email?.split("@")[0] ||
    t("sidebar.defaultUser");

  return (
    <div>
      <div className="mx-auto w-full max-w-3xl px-4 pt-4">
        <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:ease-out">
          <WelcomeStats
            name={name}
            streakDays={insights.currentStreak}
            totalWords={insights.totalWords}
            wpm={insights.wpm}
            wpmAvailable={insights.wpmAvailable}
          />
        </div>
        <div className="[animation-delay:90ms] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:duration-500 motion-safe:ease-out">
          <StyleTipCard tips={STYLE_TIPS} />
        </div>
      </div>

      <HistoryView {...props} />
    </div>
  );
}
