// Minimal iCalendar (RFC 5545) VEVENT extractor — just enough to turn a meeting
// invitation's `text/calendar` part (the ICS that Google Calendar / Outlook
// attach to an invite email) into a start/end/summary we can register as an
// upcoming meeting. This is NOT a general ICS library: it reads the first VEVENT
// and the fields we surface, and is deliberately lenient about the rest.
//
// Timezones are the fiddly part. DTSTART can arrive as:
//   - UTC:        DTSTART:20260814T153000Z
//   - zoned:      DTSTART;TZID=America/New_York:20260814T113000
//   - all-day:    DTSTART;VALUE=DATE:20260814
//   - floating:   DTSTART:20260814T113000        (no zone → treat as local)
// We resolve zoned wall-clock times to a real instant with the Intl timezone
// database (no extra dependency), falling back to local time if the TZID is
// unknown. All-day events are flagged and skipped by meeting detection.

// Compute (zoneWallClock - UTC) offset, in ms, for `tzid` at instant `utcMs`.
// Uses Intl's IANA tz data. Throws if `tzid` is not a valid zone.
function zoneOffsetMs(tzid, utcMs) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(utcMs)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asIfUtc - utcMs;
}

// Convert a wall-clock time in `tzid` to a UTC-millis instant. Two-step so a
// wall time near a DST transition still resolves to the correct offset.
function wallClockToUtcMs(y, mo, d, h, mi, s, tzid) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    const utc1 = guess - zoneOffsetMs(tzid, guess);
    const utc2 = guess - zoneOffsetMs(tzid, utc1);
    return utc2;
  } catch {
    // Unknown TZID → interpret as local wall-clock time.
    return new Date(y, mo - 1, d, h, mi, s).getTime();
  }
}

// Parse an ICS date/time value with its property params (e.g. TZID, VALUE=DATE).
// Returns { iso, isAllDay } or null.
function parseIcsDate(value, params) {
  if (!value) return null;
  const raw = value.trim();

  // All-day: VALUE=DATE or a bare YYYYMMDD.
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if ((params.VALUE === "DATE" || !raw.includes("T")) && dateOnly) {
    const [, y, mo, d] = dateOnly;
    return { iso: `${y}-${mo}-${d}`, isAllDay: true };
  }

  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
  if (!dt) return null;
  const [, y, mo, d, h, mi, s, zulu] = dt.map((v, i) => (i === 0 || i === 7 ? v : Number(v)));

  let ms;
  if (zulu) {
    ms = Date.UTC(y, mo - 1, d, h, mi, s); // trailing Z → UTC
  } else if (params.TZID) {
    ms = wallClockToUtcMs(y, mo, d, h, mi, s, params.TZID);
  } else {
    ms = new Date(y, mo - 1, d, h, mi, s).getTime(); // floating → local
  }
  return { iso: new Date(ms).toISOString(), isAllDay: false };
}

// Unfold folded content lines (RFC 5545 §3.1: a CRLF followed by a space/tab
// continues the previous line) and normalise line endings.
function unfold(ics) {
  return String(ics).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

// Split a content line into { name, params, value }.
// e.g. "DTSTART;TZID=America/New_York:20260814T113000"
function parseLine(line) {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(";");
  const params = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq !== -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value };
}

// Unescape ICS TEXT values (\, \; \n etc.).
function unescapeText(value) {
  return String(value)
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

// Parse the first VEVENT from an ICS blob. Returns null if there is no usable
// timed/dated start. Shape:
//   { summary, startIso, endIso, isAllDay, location, url, organizer, method, status, uid }
function parseIcsEvent(ics) {
  if (!ics || typeof ics !== "string") return null;
  const lines = unfold(ics).split("\n");

  let method = null;
  let inEvent = false;
  const ev = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    if (!inEvent) {
      if (name === "METHOD") method = value.trim().toUpperCase();
      if (name === "BEGIN" && value.trim().toUpperCase() === "VEVENT") inEvent = true;
      continue;
    }
    if (name === "END" && value.trim().toUpperCase() === "VEVENT") break;

    switch (name) {
      case "SUMMARY":
        ev.summary = unescapeText(value).trim();
        break;
      case "DTSTART":
        ev.start = parseIcsDate(value, params);
        break;
      case "DTEND":
        ev.end = parseIcsDate(value, params);
        break;
      case "LOCATION":
        ev.location = unescapeText(value).trim();
        break;
      case "URL":
        ev.url = value.trim();
        break;
      case "STATUS":
        ev.status = value.trim().toUpperCase();
        break;
      case "UID":
        ev.uid = value.trim();
        break;
      case "ORGANIZER":
        ev.organizer = (value.match(/mailto:([^\s;]+)/i)?.[1] || "").trim() || null;
        break;
      case "DESCRIPTION":
        ev.description = unescapeText(value).trim();
        break;
      default:
        break;
    }
  }

  if (!ev.start) return null;

  return {
    uid: ev.uid || null,
    summary: ev.summary || null,
    startIso: ev.start.iso,
    endIso: ev.end?.iso || null,
    isAllDay: ev.start.isAllDay,
    location: ev.location || null,
    url: ev.url || null,
    description: ev.description || null,
    organizer: ev.organizer || null,
    // CANCELLED invites should prune, not add.
    status: (ev.status || (method === "CANCEL" ? "CANCELLED" : "CONFIRMED")).toUpperCase(),
    method: method || null,
  };
}

module.exports = { parseIcsEvent, parseIcsDate, wallClockToUtcMs };
