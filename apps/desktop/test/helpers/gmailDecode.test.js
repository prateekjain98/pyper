const test = require("node:test");
const assert = require("node:assert/strict");

// decodeGmailMessage is a pure export; requiring the manager under plain node is
// safe (electron resolves to a path string; net/BrowserWindow are only touched
// inside methods we do not call here).
const { decodeGmailMessage } = require("../../src/helpers/gmailMeetingManager");

const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");

test("flattens headers, ICS part, and plain body from a Gmail payload", () => {
  const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260814T153000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const message = {
    internalDate: "1755180000000",
    payload: {
      headers: [
        { name: "Subject", value: "Invitation: Sync" },
        { name: "From", value: "Jane <jane@acme.com>" },
      ],
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("Join the meeting") } },
        { mimeType: "text/calendar", body: { data: b64url(ics) } },
      ],
    },
  };
  const decoded = decodeGmailMessage(message);
  assert.equal(decoded.subject, "Invitation: Sync");
  assert.equal(decoded.from, "Jane <jane@acme.com>");
  assert.equal(decoded.icsText, ics);
  assert.equal(decoded.bodyText, "Join the meeting");
  assert.equal(decoded.receivedMs, 1755180000000);
});

test("picks up an .ics attachment part by filename", () => {
  const ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260814T153000Z\nEND:VEVENT\nEND:VCALENDAR";
  const message = {
    payload: {
      headers: [{ name: "Subject", value: "Invite" }],
      parts: [
        { mimeType: "application/octet-stream", filename: "invite.ics", body: { data: b64url(ics) } },
      ],
    },
  };
  assert.equal(decodeGmailMessage(message).icsText, ics);
});

test("falls back to stripped HTML when there is no plain part", () => {
  const message = {
    payload: {
      headers: [],
      parts: [{ mimeType: "text/html", body: { data: b64url("<p>Join <b>now</b></p>") } }],
    },
  };
  assert.equal(decodeGmailMessage(message).bodyText, "Join now");
});
