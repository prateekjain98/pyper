import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Hash, Loader2, Send, Unlink, Webhook } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SettingsPanel, SettingsPanelRow } from "./ui/SettingsSection";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { useToast } from "./ui/useToast";
import slackIcon from "../assets/icons/slack.svg";

type SlackMethod = "webhook" | "token";

interface SlackStatus {
  connected: boolean;
  method: SlackMethod | null;
  channel: string;
}

const DEFAULT_STATUS: SlackStatus = { connected: false, method: null, channel: "" };

// Maps the IPC error codes from slack-save-* to a translatable message key.
const SAVE_ERROR_KEYS: Record<string, string> = {
  invalid_webhook_url: "integrations.slack.errorInvalidWebhook",
  invalid_bot_token: "integrations.slack.errorInvalidToken",
  missing_channel: "integrations.slack.errorMissingChannel",
};

export default function SlackIntegrationCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [status, setStatus] = useState<SlackStatus>(DEFAULT_STATUS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<SlackMethod>("webhook");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [token, setToken] = useState("");
  const [channel, setChannel] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const refreshStatus = useCallback(async () => {
    const result = await window.electronAPI?.slackGetStatus?.();
    if (result) setStatus(result);
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const openDialog = useCallback(() => {
    setMode("webhook");
    setWebhookUrl("");
    setToken("");
    setChannel("");
    setErrorKey(null);
    setDialogOpen(true);
  }, []);

  const handleConnect = useCallback(async () => {
    setErrorKey(null);
    setSaving(true);
    try {
      const result =
        mode === "webhook"
          ? await window.electronAPI?.slackSaveWebhook?.(webhookUrl.trim())
          : await window.electronAPI?.slackSaveToken?.(token.trim(), channel.trim());
      if (result?.success) {
        await refreshStatus();
        setDialogOpen(false);
        toast({ title: t("integrations.slack.connectedToast"), variant: "success", duration: 2500 });
      } else {
        setErrorKey(
          (result?.error && SAVE_ERROR_KEYS[result.error]) || "integrations.slack.connectFailed"
        );
      }
    } finally {
      setSaving(false);
    }
  }, [mode, webhookUrl, token, channel, refreshStatus, toast, t]);

  const handleDisconnect = useCallback(async () => {
    await window.electronAPI?.slackDisconnect?.();
    await refreshStatus();
  }, [refreshStatus]);

  const handleSendTest = useCallback(async () => {
    setSending(true);
    try {
      const result = await window.electronAPI?.slackPostMessage?.(t("integrations.slack.testMessage"));
      if (result?.success) {
        toast({ title: t("integrations.slack.testSent"), variant: "success", duration: 2500 });
      } else {
        toast({
          title: t("integrations.slack.testFailed"),
          description: result?.error,
          variant: "destructive",
          duration: 4000,
        });
      }
    } finally {
      setSending(false);
    }
  }, [toast, t]);

  const statusLine =
    status.method === "token"
      ? t("integrations.slack.statusChannel", { channel: status.channel })
      : t("integrations.slack.statusWebhook");

  return (
    <SettingsPanel>
      <SettingsPanelRow>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white dark:bg-surface-raised shadow-[0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-none dark:border dark:border-white/5 flex items-center justify-center shrink-0">
            <img src={slackIcon} alt="" className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold text-foreground">
                {t("integrations.slack.title")}
              </p>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                {t("integrations.slack.optional")}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground/70 mt-0.5 leading-relaxed">
              {t("integrations.slack.description")}
            </p>
          </div>
          {status.connected ? (
            <Badge variant="success" className="shrink-0">
              {t("integrations.slack.connected")}
            </Badge>
          ) : (
            <Button size="sm" onClick={openDialog} className="shrink-0">
              {t("integrations.slack.connect")}
            </Button>
          )}
        </div>
      </SettingsPanelRow>

      {status.connected && (
        <SettingsPanelRow>
          <div className="group flex items-center gap-3 pl-12">
            {status.method === "token" ? (
              <Hash className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            ) : (
              <Webhook className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            )}
            <span className="text-xs text-muted-foreground truncate flex-1">{statusLine}</span>
            <button
              onClick={handleSendTest}
              disabled={sending}
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50 shrink-0"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {t("integrations.slack.sendTest")}
            </button>
            <button
              onClick={() => setConfirmDisconnect(true)}
              className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
              aria-label={t("integrations.slack.disconnect")}
            >
              <Unlink className="h-3.5 w-3.5" />
            </button>
          </div>
        </SettingsPanelRow>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("integrations.slack.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("integrations.slack.dialogDescription")}</DialogDescription>
          </DialogHeader>

          <div className="inline-flex rounded-lg bg-muted/50 dark:bg-surface-1 p-0.5 gap-0.5 w-full">
            {(["webhook", "token"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setErrorKey(null);
                }}
                className={`flex-1 text-xs font-medium rounded-md px-3 py-1.5 transition-colors ${
                  mode === m
                    ? "bg-white dark:bg-surface-raised text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(
                  m === "webhook"
                    ? "integrations.slack.methodWebhook"
                    : "integrations.slack.methodToken"
                )}
              </button>
            ))}
          </div>

          {mode === "webhook" ? (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">
                {t("integrations.slack.webhookLabel")}
              </label>
              <Input
                type="text"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder={t("integrations.slack.webhookPlaceholder")}
                className="h-8 text-sm font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground/70 leading-relaxed">
                {t("integrations.slack.webhookHelp")}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">
                  {t("integrations.slack.tokenLabel")}
                </label>
                <Input
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={t("integrations.slack.tokenPlaceholder")}
                  className="h-8 text-sm font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">
                  {t("integrations.slack.channelLabel")}
                </label>
                <Input
                  type="text"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  placeholder={t("integrations.slack.channelPlaceholder")}
                  className="h-8 text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground/70 leading-relaxed">
                  {t("integrations.slack.channelHelp")}
                </p>
              </div>
            </div>
          )}

          {errorKey && <p className="text-xs text-destructive leading-relaxed">{t(errorKey)}</p>}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              {t("integrations.slack.cancel")}
            </Button>
            <Button size="sm" onClick={handleConnect} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("integrations.slack.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={t("integrations.slack.disconnectConfirm")}
        description={t("integrations.slack.disconnectDescription")}
        confirmText={t("integrations.slack.disconnect")}
        variant="destructive"
        onConfirm={handleDisconnect}
      />
    </SettingsPanel>
  );
}
