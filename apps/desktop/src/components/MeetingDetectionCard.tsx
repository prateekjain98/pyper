import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Loader2, Mail, Sparkles, Unlink } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { SettingsPanel, SettingsPanelRow, SettingsRow } from "./ui/SettingsSection";
import { Toggle } from "./ui/toggle";
import { ConfirmDialog } from "./ui/dialog";
import { useToast } from "./ui/useToast";
import slackIcon from "../assets/icons/slack.svg";

interface SignalStatus {
  gmail: { connected: boolean; email?: string | null; configured?: boolean };
  slack: { enabled: boolean; hasToken: boolean; canSearch?: boolean };
}

const DEFAULT_STATUS: SignalStatus = {
  gmail: { connected: false },
  slack: { enabled: false, hasToken: false },
};

// Detect upcoming meetings/huddles from Gmail (calendar invites + meeting links)
// and Slack (huddles + meeting links). Both feed the shared meeting pipeline, so
// a detected meeting shows up in the notification overlay and the Upcoming
// Meetings list automatically.
export default function MeetingDetectionCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [status, setStatus] = useState<SignalStatus>(DEFAULT_STATUS);
  const [connecting, setConnecting] = useState(false);
  const [togglingSlack, setTogglingSlack] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const refresh = useCallback(async () => {
    const s = await window.electronAPI?.meetingSignalGetStatus?.();
    if (s?.success) {
      setStatus({ gmail: s.gmail ?? DEFAULT_STATUS.gmail, slack: s.slack ?? DEFAULT_STATUS.slack });
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsub = window.electronAPI?.onGmailConnectionChanged?.(() => refresh());
    return () => unsub?.();
  }, [refresh]);

  const connectGmail = useCallback(async () => {
    setConnecting(true);
    try {
      const res = await window.electronAPI?.gmailStartOAuth?.();
      if (res?.success) {
        await refresh();
        toast({
          title: t("integrations.meetingDetection.gmailConnected"),
          variant: "success",
          duration: 2500,
        });
      } else if (!res?.error?.includes("access_denied")) {
        toast({
          title: t("integrations.meetingDetection.gmailFailed"),
          description: res?.error,
          variant: "destructive",
          duration: 4000,
        });
      }
    } finally {
      setConnecting(false);
    }
  }, [refresh, toast, t]);

  const disconnectGmail = useCallback(async () => {
    await window.electronAPI?.gmailDisconnect?.();
    await refresh();
  }, [refresh]);

  const toggleSlack = useCallback(
    async (enabled: boolean) => {
      setTogglingSlack(true);
      try {
        const res = await window.electronAPI?.slackMeetingDetectionSet?.(enabled);
        if (res?.success && res.slack) {
          setStatus((prev) => ({ ...prev, slack: res.slack! }));
          if (enabled && res.slack.hasToken && res.slack.canSearch === false) {
            toast({
              title: t("integrations.meetingDetection.slackNeedsUserToken"),
              variant: "destructive",
              duration: 5000,
            });
          }
        } else {
          await refresh();
        }
      } finally {
        setTogglingSlack(false);
      }
    },
    [refresh, toast, t]
  );

  const runTest = useCallback(async () => {
    setInjecting(true);
    try {
      await window.electronAPI?.injectTestMeeting?.({ provider: "gmail", minutesUntilStart: 0 });
      toast({
        title: t("integrations.meetingDetection.testTriggered"),
        description: t("integrations.meetingDetection.testTriggeredDescription"),
        variant: "success",
        duration: 3000,
      });
    } finally {
      setInjecting(false);
    }
  }, [toast, t]);

  return (
    <SettingsPanel>
      <SettingsPanelRow>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/5 dark:bg-primary/10 flex items-center justify-center shrink-0">
            <CalendarClock className="h-4 w-4 text-primary/80" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold text-foreground">
                {t("integrations.meetingDetection.title")}
              </p>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                {t("integrations.meetingDetection.optional")}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground/70 mt-0.5 leading-relaxed">
              {t("integrations.meetingDetection.description")}
            </p>
          </div>
        </div>
      </SettingsPanelRow>

      {/* Gmail — calendar invites + meeting links */}
      <SettingsPanelRow>
        <div className="group flex items-center gap-3 pl-1">
          <div className="w-9 h-9 rounded-lg bg-white dark:bg-surface-raised shadow-[0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-none dark:border dark:border-white/5 flex items-center justify-center shrink-0">
            <Mail className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground">
              {t("integrations.meetingDetection.gmailTitle")}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-0.5 leading-relaxed truncate">
              {status.gmail.connected && status.gmail.email
                ? status.gmail.email
                : t("integrations.meetingDetection.gmailDescription")}
            </p>
          </div>
          {status.gmail.connected ? (
            <button
              onClick={() => setConfirmDisconnect(true)}
              className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
              aria-label={t("integrations.meetingDetection.disconnect")}
            >
              <Unlink className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Button size="sm" onClick={connectGmail} disabled={connecting} className="shrink-0">
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                t("integrations.meetingDetection.connect")
              )}
            </Button>
          )}
        </div>
      </SettingsPanelRow>

      {status.gmail.configured === false && (
        <SettingsPanelRow>
          <p className="text-[11px] text-muted-foreground/60 leading-relaxed pl-1">
            {t("integrations.meetingDetection.gmailNotConfigured")}
          </p>
        </SettingsPanelRow>
      )}

      {/* Slack — huddles + meeting links (reuses the connected Slack token) */}
      <SettingsPanelRow>
        <div className="flex items-center gap-3 pl-1">
          <div className="w-9 h-9 rounded-lg bg-white dark:bg-surface-raised shadow-[0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-none dark:border dark:border-white/5 flex items-center justify-center shrink-0">
            <img src={slackIcon} alt="" className="w-5 h-5" />
          </div>
          <SettingsRow
            label={t("integrations.meetingDetection.slackTitle")}
            description={
              status.slack.hasToken
                ? t("integrations.meetingDetection.slackDescription")
                : t("integrations.meetingDetection.slackNeedsConnection")
            }
          >
            <div className="flex items-center gap-2">
              {togglingSlack && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <Toggle
                checked={status.slack.enabled}
                onChange={toggleSlack}
                disabled={!status.slack.hasToken || togglingSlack}
              />
            </div>
          </SettingsRow>
        </div>
      </SettingsPanelRow>

      {/* Verify the pipeline without a live account. */}
      <SettingsPanelRow>
        <div className="flex items-center gap-3 pl-1">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground/80">
              {t("integrations.meetingDetection.testTitle")}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-0.5 leading-relaxed">
              {t("integrations.meetingDetection.testDescription")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={runTest}
            disabled={injecting}
            className="shrink-0"
          >
            {injecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                {t("integrations.meetingDetection.testButton")}
              </>
            )}
          </Button>
        </div>
      </SettingsPanelRow>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={t("integrations.meetingDetection.disconnect")}
        description={t("integrations.meetingDetection.gmailDisconnectDescription")}
        confirmText={t("integrations.meetingDetection.disconnect")}
        variant="destructive"
        onConfirm={disconnectGmail}
      />
    </SettingsPanel>
  );
}
