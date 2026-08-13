import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Settings,
  Search,
  CalendarPlus,
  FileText,
  Users,
  Upload as UploadIcon,
  Loader2,
  Sparkles,
  Bot,
  Download,
  X,
} from "lucide-react";
import UpcomingMeetings from "../UpcomingMeetings";
import { useUpcomingEvents } from "../../hooks/useUpcomingEvents";
import type { NoteItem } from "../../types/electron";
import { cn } from "../lib/utils";
import { useChatPersistence } from "../chat/useChatPersistence";
import { useChatStreaming } from "../chat/useChatStreaming";
import { useChatMessageSender } from "../chat/useChatMessageSender";
import { ChatMessages } from "../chat/ChatMessages";
import { ChatInput } from "../chat/ChatInput";

interface AiNoteTakerViewProps {
  onOpenSettings?: (section?: string) => void;
  onConnectCalendar?: () => void;
  onOpenNote?: (noteId: number) => void;
  onNewNote?: () => void;
  onImport?: () => void;
}

const noteTypeIcon: Record<NoteItem["note_type"], React.ComponentType<{ size?: number; className?: string }>> = {
  meeting: Users,
  upload: UploadIcon,
  personal: FileText,
};

const IMPORT_DISMISSED_KEY = "notetakerImportDismissed";

/**
 * AI Note-Taker — a Wispr-Flow-style notetaker hub. Up top: your upcoming
 * Google/MS/Apple calendar meetings (join + record), reusing `useUpcomingEvents`
 * + `UpcomingMeetings`. Below: your notes (`getNotes`). A collapsible Assistant
 * panel (right) reuses the chat engine, whose tools already read + write notes.
 */
export default function AiNoteTakerView({
  onOpenSettings,
  onConnectCalendar,
  onOpenNote,
  onNewNote,
  onImport,
}: AiNoteTakerViewProps) {
  const { t } = useTranslation();
  const { events, isLoading: eventsLoading, isConnected } = useUpcomingEvents();

  const [tab, setTab] = useState<"mine" | "shared">("mine");
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [importDismissed, setImportDismissed] = useState(
    () => localStorage.getItem(IMPORT_DISMISSED_KEY) === "true"
  );
  const [assistantOpen, setAssistantOpen] = useState(false);

  // ------------------------------- Assistant -------------------------------
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const persistence = useChatPersistence({
    conversationId: activeConversationId,
    onConversationCreated: (id) => setActiveConversationId(id),
  });
  const streaming = useChatStreaming({
    messages: persistence.messages,
    setMessages: persistence.setMessages,
    onStreamComplete: (_id, content, toolCalls) => persistence.saveAssistantMessage(content, toolCalls),
  });
  const createConversation = useCallback(
    (text: string) => persistence.createConversation(text.length > 50 ? `${text.slice(0, 50)}...` : text),
    [persistence]
  );
  const handleAssistantSubmit = useChatMessageSender({
    conversationId: activeConversationId,
    persistence,
    streaming,
    createConversation,
  });

  // --------------------------------- Notes ---------------------------------
  const loadNotes = useCallback(async () => {
    setNotesLoading(true);
    try {
      const result = await window.electronAPI?.getNotes?.(undefined, 100);
      setNotes(Array.isArray(result) ? (result as NoteItem[]) : []);
    } catch {
      setNotes([]);
    } finally {
      setNotesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const dismissImport = useCallback(() => {
    setImportDismissed(true);
    localStorage.setItem(IMPORT_DISMISSED_KEY, "true");
  }, []);

  const visibleNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes
      .filter((n) => (tab === "shared" ? n.is_shared : true))
      .filter((n) => (q ? (n.title || "").toLowerCase().includes(q) : true));
  }, [notes, tab, query]);

  const assistantSuggestions = [
    t("aiNoteTaker.assistant.suggest1"),
    t("aiNoteTaker.assistant.suggest2"),
  ];

  return (
    <div className="flex h-full min-h-0 bg-background">
      {/* ============================ Main column ============================ */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-8 py-7">
          {/* --------------------------- Header --------------------------- */}
          <header className="mb-7 flex items-center justify-between gap-4">
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground">
              {t("aiNoteTaker.title")}
            </h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAssistantOpen((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  assistantOpen
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/50 text-foreground/80 hover:bg-foreground/5 dark:border-white/8 dark:hover:bg-white/5"
                )}
              >
                <Sparkles size={15} />
                {t("aiNoteTaker.assistant.title")}
              </button>
              <button
                type="button"
                onClick={onNewNote}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus size={15} />
                {t("aiNoteTaker.newNote")}
              </button>
              <button
                type="button"
                onClick={() => onOpenSettings?.()}
                aria-label={t("sidebar.settings")}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground dark:hover:bg-white/5"
              >
                <Settings size={17} />
              </button>
            </div>
          </header>

          {/* ------------------------ Import banner ----------------------- */}
          {!importDismissed && (
            <div className="mb-6 flex items-center gap-4 rounded-xl border border-border/40 bg-surface-1/50 p-4 dark:border-white/6 dark:bg-surface-1/40">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/70 dark:bg-white/5">
                <Download size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{t("aiNoteTaker.import.title")}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("aiNoteTaker.import.description")}
                </p>
              </div>
              <button
                type="button"
                onClick={dismissImport}
                className="shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("aiNoteTaker.import.skip")}
              </button>
              <button
                type="button"
                onClick={onImport}
                className="shrink-0 rounded-lg bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                {t("aiNoteTaker.import.button")}
              </button>
            </div>
          )}

          {/* ---------------------- Upcoming meetings --------------------- */}
          <section className="mb-9">
            {isConnected ? (
              <UpcomingMeetings events={events} isLoading={eventsLoading} />
            ) : (
              <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-surface-1/50 p-5 dark:border-white/6 dark:bg-surface-1/40">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CalendarPlus size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {t("aiNoteTaker.connectCalendar.title")}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("aiNoteTaker.connectCalendar.description")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onConnectCalendar}
                  className="shrink-0 rounded-lg bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
                >
                  {t("aiNoteTaker.connectCalendar.button")}
                </button>
              </div>
            )}
          </section>

          {/* ----------------------------- Notes -------------------------- */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-4 border-b border-border/15 dark:border-white/6">
              <div className="flex items-center gap-5">
                {(["mine", "shared"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={cn(
                      "-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors",
                      tab === id
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {id === "mine" ? t("aiNoteTaker.notes.mine") : t("aiNoteTaker.notes.shared")}
                  </button>
                ))}
              </div>
              <div className="relative mb-1.5">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("aiNoteTaker.notes.search")}
                  className="h-7 w-44 rounded-md border border-border/50 bg-card/50 pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-primary/30 dark:border-white/8"
                />
              </div>
            </div>

            {notesLoading ? (
              <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
                <Loader2 size={15} className="animate-spin" />
                {t("common.loading")}
              </div>
            ) : visibleNotes.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/50 py-14 text-center dark:border-white/8">
                <FileText size={22} className="text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">{t("aiNoteTaker.notes.empty")}</p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {visibleNotes.map((note) => {
                  const Icon = noteTypeIcon[note.note_type] ?? FileText;
                  const snippet = (note.enhanced_content || note.content || "").replace(/\s+/g, " ").trim();
                  return (
                    <li key={note.id}>
                      <button
                        type="button"
                        onClick={() => onOpenNote?.(note.id)}
                        className="group flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border/40 hover:bg-foreground/[0.03] dark:hover:border-white/6 dark:hover:bg-white/[0.03]"
                      >
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-foreground/60 dark:bg-white/5">
                          <Icon size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {note.title || t("aiNoteTaker.notes.untitled")}
                          </span>
                          {snippet && (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {snippet}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* ========================= Assistant panel ========================= */}
      {assistantOpen && (
        <aside className="flex w-[360px] shrink-0 flex-col border-l border-border/15 bg-surface-1/30 dark:border-white/6 dark:bg-surface-1/50">
          <header className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Bot size={15} />
              </div>
              <h2 className="text-sm font-semibold text-foreground">
                {t("aiNoteTaker.assistant.title")}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setAssistantOpen(false)}
              aria-label={t("common.close")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground dark:hover:bg-white/5"
            >
              <X size={15} />
            </button>
          </header>

          <div className="min-h-0 flex-1">
            <ChatMessages
              messages={persistence.messages}
              onOpenNote={onOpenNote}
              emptyState={
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("aiNoteTaker.assistant.empty")}
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {assistantSuggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleAssistantSubmit(s)}
                        className="rounded-full border border-border/50 bg-card/50 px-2.5 py-1 text-[11px] text-foreground/80 transition-colors hover:bg-foreground/5 dark:border-white/8"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              }
            />
          </div>

          <ChatInput
            agentState={streaming.agentState}
            partialTranscript=""
            onTextSubmit={handleAssistantSubmit}
            onCancel={streaming.cancelStream}
            placeholder={t("aiNoteTaker.assistant.placeholder")}
          />
        </aside>
      )}
    </div>
  );
}
