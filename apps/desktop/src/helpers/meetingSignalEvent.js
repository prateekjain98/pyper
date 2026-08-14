// Build a `calendar_events` row from a detected Slack/Gmail meeting signal.
// Every signal source (Gmail invites, Gmail/Slack meeting links, live huddles,
// the dev trigger) funnels through here so they all produce the exact row shape
// `ConvexDatabaseManager.upsertCalendarEvents` stores and that the reminder
// scheduler, the detection overlay, and the Upcoming Meetings list already read.
//
// Design choices that make the existing pipeline "just work":
//   - `is_all_day: 0` + `status: "confirmed"` so getUpcomingEvents/getActiveEvents
//     include the row (they filter out all-day and non-confirmed/tentative rows).
//   - the join link goes in `hangout_link`, which `getMeetingJoinUrl()` reads
//     first — so the overlay's Join button and the Upcoming list's join action
//     work with no extra wiring.
//   - `provider` doubles as the synthetic `calendar_id`, so pruning stale rows
//     via `removeStaleCalendarEvents(provider, provider, freshIds)` is clean.

const HOUR_MS = 60 * 60 * 1000;

const DEFAULT_SUMMARY = {
  slack: "Slack huddle",
  gmail: "Meeting",
};

// Returns a normalized calendar_events row, or null when the signal is unusable
// (missing provider/id or an unparseable start time).
function buildSignalEvent({
  provider,
  id,
  summary,
  startIso,
  endIso = null,
  joinUrl = null,
  organizerEmail = null,
  attendeesCount = 0,
  status = "confirmed",
} = {}) {
  if (!provider || !id || !startIso) return null;

  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) return null;

  const parsedEnd = endIso ? Date.parse(endIso) : NaN;
  const endMs = !Number.isNaN(parsedEnd) && parsedEnd > startMs ? parsedEnd : startMs + HOUR_MS;

  const normalizedStatus = String(status || "confirmed").toLowerCase();

  return {
    id: String(id),
    calendar_id: provider,
    provider,
    summary: (summary && String(summary).trim()) || DEFAULT_SUMMARY[provider] || "Meeting",
    start_time: new Date(startMs).toISOString(),
    end_time: new Date(endMs).toISOString(),
    is_all_day: 0,
    status: normalizedStatus === "cancelled" ? "cancelled" : normalizedStatus,
    hangout_link: joinUrl || null,
    conference_data: null,
    organizer_email: organizerEmail || null,
    attendees_count: Number(attendeesCount) || 0,
    attendees: null,
  };
}

module.exports = { buildSignalEvent };
