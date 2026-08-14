import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { SectionHeader, SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";
import { Toggle } from "../ui/toggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Button } from "../ui/button";

const noop = () => {};

// Mirrors the settings dropdowns used elsewhere (e.g. Chinese-script select).
const SELECT_TRIGGER_CLASS = "h-7 w-44 text-xs rounded-lg px-2.5 [&>svg]:h-3 [&>svg]:w-3";

export default function NotetakerSettings() {
  const { t } = useTranslation();

  // Reused (existing) settings.
  const notifyMeetingDetection = useSettingsStore((s) => s.notifyMeetingDetection);
  const setNotifyMeetingDetection = useSettingsStore((s) => s.setNotifyMeetingDetection);
  const notifyCalendarReminders = useSettingsStore((s) => s.notifyCalendarReminders);
  const setNotifyCalendarReminders = useSettingsStore((s) => s.setNotifyCalendarReminders);
  const showTranscriptionPreview = useSettingsStore((s) => s.showTranscriptionPreview);
  const setShowTranscriptionPreview = useSettingsStore((s) => s.setShowTranscriptionPreview);

  // New Notetaker settings.
  const meetingReminderLeadSeconds = useSettingsStore((s) => s.meetingReminderLeadSeconds);
  const setMeetingReminderLeadSeconds = useSettingsStore((s) => s.setMeetingReminderLeadSeconds);
  const maxRecordingLengthMinutes = useSettingsStore((s) => s.maxRecordingLengthMinutes);
  const setMaxRecordingLengthMinutes = useSettingsStore((s) => s.setMaxRecordingLengthMinutes);
  const stopNotetakerOnCallEnd = useSettingsStore((s) => s.stopNotetakerOnCallEnd);
  const setStopNotetakerOnCallEnd = useSettingsStore((s) => s.setStopNotetakerOnCallEnd);
  const notesSharingDefault = useSettingsStore((s) => s.notesSharingDefault);
  const setNotesSharingDefault = useSettingsStore((s) => s.setNotesSharingDefault);
  const notetakerAutoSummarize = useSettingsStore((s) => s.notetakerAutoSummarize);
  const setNotetakerAutoSummarize = useSettingsStore((s) => s.setNotetakerAutoSummarize);

  // "Off" mirrors notifyCalendarReminders being disabled; the other options both
  // set the lead time and re-enable the calendar reminder prompt.
  const reminderValue = notifyCalendarReminders ? String(meetingReminderLeadSeconds) : "0";
  const handleReminderChange = (value: string) => {
    const seconds = Number(value);
    setMeetingReminderLeadSeconds(seconds);
    setNotifyCalendarReminders(seconds > 0);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xs font-semibold text-foreground tracking-tight">
            {t("settings.notetaker.title")}
          </h3>
          <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">
            {t("settings.notetaker.description")}
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={noop}>
          {t("settings.notetaker.startTutorial")}
        </Button>
      </div>

      {/* Meeting detection */}
      <div>
        <SectionHeader title={t("settings.notetaker.meetingDetection.title")} />
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow
              label={t("settings.notetaker.reminderLead.title")}
              description={t("settings.notetaker.reminderLead.description")}
            >
              <Select value={reminderValue} onValueChange={handleReminderChange}>
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t("settings.notetaker.reminderLead.off")}</SelectItem>
                  <SelectItem value="15">{t("settings.notetaker.reminderLead.sec15")}</SelectItem>
                  <SelectItem value="60">{t("settings.notetaker.reminderLead.min1")}</SelectItem>
                  <SelectItem value="300">{t("settings.notetaker.reminderLead.min5")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
          </SettingsPanelRow>

          <SettingsPanelRow>
            <SettingsRow
              label={t("settings.notetaker.autoDetect.title")}
              description={t("settings.notetaker.autoDetect.description")}
            >
              <Toggle checked={notifyMeetingDetection} onChange={setNotifyMeetingDetection} />
            </SettingsRow>
          </SettingsPanelRow>

          <SettingsPanelRow>
            <SettingsRow
              label={t("settings.notetaker.maxRecordingLength.title")}
              description={t("settings.notetaker.maxRecordingLength.description")}
            >
              <Select
                value={String(maxRecordingLengthMinutes)}
                onValueChange={(value) => setMaxRecordingLengthMinutes(Number(value))}
              >
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="60">
                    {t("settings.notetaker.maxRecordingLength.hour1")}
                  </SelectItem>
                  <SelectItem value="120">
                    {t("settings.notetaker.maxRecordingLength.hour2")}
                  </SelectItem>
                  <SelectItem value="180">
                    {t("settings.notetaker.maxRecordingLength.hour3")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
          </SettingsPanelRow>

          <SettingsPanelRow>
            <SettingsRow
              label={t("settings.notetaker.stopOnCallEnd.title")}
              description={t("settings.notetaker.stopOnCallEnd.description")}
            >
              <Toggle checked={stopNotetakerOnCallEnd} onChange={setStopNotetakerOnCallEnd} />
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>

      {/* Transcript */}
      <div>
        <SectionHeader title={t("settings.notetaker.transcript.title")} />
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow
              label={t("settings.notetaker.liveTranscript.title")}
              description={t("settings.notetaker.liveTranscript.description")}
            >
              <Toggle checked={showTranscriptionPreview} onChange={setShowTranscriptionPreview} />
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>

      {/* Sharing */}
      <div>
        <SectionHeader title={t("settings.notetaker.sharing.title")} />
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow
              label={t("settings.notetaker.notesSharing.title")}
              description={t("settings.notetaker.notesSharing.description")}
            >
              <Select value={notesSharingDefault} onValueChange={setNotesSharingDefault}>
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="invite">
                    {t("settings.notetaker.notesSharing.invite")}
                  </SelectItem>
                  <SelectItem value="link">{t("settings.notetaker.notesSharing.link")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>

      {/* Automation */}
      <div>
        <SectionHeader title={t("settings.notetaker.automation.title")} />
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow
              label={t("settings.notetaker.autoSummarize.title")}
              description={t("settings.notetaker.autoSummarize.description")}
            >
              <Toggle checked={notetakerAutoSummarize} onChange={setNotetakerAutoSummarize} />
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>

      {/* Import */}
      <div>
        <SectionHeader title={t("settings.notetaker.import.title")} />
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow
              label={t("settings.notetaker.import.granolaTitle")}
              description={t("settings.notetaker.import.granolaDescription")}
            >
              <Button variant="outline" size="sm" className="shrink-0" onClick={noop}>
                {t("settings.notetaker.import.button")}
              </Button>
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>
    </div>
  );
}
