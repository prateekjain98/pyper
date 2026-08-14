// Turn a decoded Gmail message into a meeting signal. Pure + synchronous so it
// is fully unit-testable; the network/decoding lives in gmailMeetingManager.js.
//
// Two signals, in priority order (both were opted into):
//   1. Calendar invite — a `text/calendar` (ICS) part carries the REAL start/end
//      time. This is the reliable "upcoming meeting" source.
//   2. Bare meeting link — a Zoom/Meet/Teams/Webex link in a *fresh* email (no
//      ICS) is treated as a meeting starting right about now. Gated tightly on
//      recency so an old thread that merely mentions a link is not resurfaced.

const { parseIcsEvent } = require("./icsParser");
const { detectMeetingLink } = require("./meetingLinks");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LINK_FRESHNESS_MS = 15 * 60 * 1000; // link-only emails: "now" window
const FUTURE_HORIZON_MS = 30 * DAY_MS;

// Returns one of:
//   null                         → no meeting signal
//   { type: "cancel", id }       → a CANCEL invite; caller should prune this id
//   { type: "event", input }     → `input` is ready for buildSignalEvent()
//
// msg:  { id, subject, from, bodyText, icsText, receivedMs }
// opts: { nowMs, linkFreshnessMs }
function parseGmailMeeting(msg, opts = {}) {
  if (!msg || !msg.id) return null;
  const nowMs = opts.nowMs ?? Date.now();
  const linkFreshnessMs = opts.linkFreshnessMs ?? DEFAULT_LINK_FRESHNESS_MS;

  // 1. Calendar invite (ICS) — the authoritative path.
  if (msg.icsText) {
    const ev = parseIcsEvent(msg.icsText);
    if (ev && !ev.isAllDay) {
      const id = `gmail:${ev.uid || msg.id}`;
      if (ev.status === "CANCELLED") return { type: "cancel", id };

      const startMs = Date.parse(ev.startIso);
      if (!Number.isNaN(startMs)) {
        const endMs = ev.endIso ? Date.parse(ev.endIso) : startMs + 60 * 60 * 1000;
        const notOver = (Number.isNaN(endMs) ? startMs + 60 * 60 * 1000 : endMs) > nowMs;
        const notTooFar = startMs < nowMs + FUTURE_HORIZON_MS;
        if (notOver && notTooFar) {
          const joinUrl =
            ev.url ||
            detectMeetingLink(`${ev.location || ""}\n${ev.description || ""}`)?.url ||
            detectMeetingLink(msg.bodyText || "")?.url ||
            null;
          return {
            type: "event",
            input: {
              provider: "gmail",
              id,
              summary: ev.summary || msg.subject || "Meeting",
              startIso: ev.startIso,
              endIso: ev.endIso,
              joinUrl,
              organizerEmail: ev.organizer || extractEmail(msg.from),
              status: "confirmed",
            },
          };
        }
        return null;
      }
    }
  }

  // 2. Bare meeting link in a fresh email → a meeting starting about now.
  const link = detectMeetingLink(`${msg.subject || ""}\n${msg.bodyText || ""}`);
  if (link && typeof msg.receivedMs === "number" && nowMs - msg.receivedMs <= linkFreshnessMs) {
    return {
      type: "event",
      input: {
        provider: "gmail",
        id: `gmail:${msg.id}`,
        summary: msg.subject || `${link.platformName} meeting`,
        startIso: new Date(nowMs).toISOString(),
        endIso: null,
        joinUrl: link.url,
        organizerEmail: extractEmail(msg.from),
        status: "confirmed",
      },
    };
  }

  return null;
}

// Pull the address out of a "Name <addr@host>" or bare-address From header.
function extractEmail(from) {
  if (!from || typeof from !== "string") return null;
  const angle = from.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : from).trim();
  return /\S+@\S+\.\S+/.test(candidate) ? candidate : null;
}

module.exports = { parseGmailMeeting, extractEmail };
