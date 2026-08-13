// Slack integration — posts notes/summaries to Slack from the MAIN process,
// via either an Incoming Webhook URL (simplest, no OAuth app required) or a
// Bot User OAuth token + channel (chat.postMessage). Credentials are stored
// encrypted through environment.js (SECRET_KEYS); this module only ever
// receives already-resolved values and never logs the webhook URL or token.
const { net } = require("electron");

const CHAT_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
const WEBHOOK_HOST = "hooks.slack.com";

// Default fetch uses Electron's net stack so system proxies are honored — the
// same approach as proxyFetch elsewhere in the main process. Injectable so unit
// tests can drive the POST logic without a real network.
function defaultFetch(url, init) {
  return net.fetch(url, { ...init, useSessionCookies: false });
}

// A Slack Incoming Webhook is always https://hooks.slack.com/... — validating
// the host also keeps us from POSTing a note to an arbitrary URL by mistake.
function validateWebhookUrl(url) {
  if (typeof url !== "string") return false;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname === WEBHOOK_HOST;
}

// Bot User OAuth tokens start with xoxb-; user tokens with xoxp-. Accept both
// so a user token also works with chat.postMessage.
function validateBotToken(token) {
  return typeof token === "string" && /^xox[bp]-/.test(token.trim());
}

async function postToWebhook(webhookUrl, text, fetchImpl = defaultFetch) {
  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  // Incoming Webhooks reply HTTP 200 with the literal body "ok" on success.
  const body = (await response.text()).trim();
  if (!response.ok || body !== "ok") {
    throw new Error(`Slack webhook rejected the message (${body || `HTTP ${response.status}`})`);
  }
  return { success: true };
}

async function postWithToken(botToken, channel, text, fetchImpl = defaultFetch) {
  const response = await fetchImpl(CHAT_POST_MESSAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel, text }),
  });
  // chat.postMessage always returns HTTP 200; success/failure is in the JSON
  // body's `ok` flag (e.g. channel_not_found, not_in_channel, invalid_auth).
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Slack API returned an invalid response (HTTP ${response.status})`);
  }
  if (!data || !data.ok) {
    throw new Error(`Slack API error: ${(data && data.error) || "unknown_error"}`);
  }
  return { success: true, channel: data.channel, ts: data.ts };
}

// Derive the connection state the renderer needs — never returns the raw
// webhook URL or bot token, only the method and (for the token path) channel.
function getStatus({ webhookUrl, botToken, channel } = {}) {
  if (webhookUrl) return { connected: true, method: "webhook", channel: "" };
  if (botToken) return { connected: true, method: "token", channel: channel || "" };
  return { connected: false, method: null, channel: "" };
}

// Post using whichever credential is configured. Only one is ever stored at a
// time (the save handlers clear the other), so webhook-first precedence is safe.
async function postMessage({ webhookUrl, botToken, channel, text } = {}, fetchImpl = defaultFetch) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Cannot send an empty message to Slack");
  }
  if (webhookUrl) return postToWebhook(webhookUrl, text, fetchImpl);
  if (botToken) {
    if (!channel || !channel.trim()) {
      throw new Error("A Slack channel is required when using a bot token");
    }
    return postWithToken(botToken, channel.trim(), text, fetchImpl);
  }
  throw new Error("Slack is not connected");
}

module.exports = {
  CHAT_POST_MESSAGE_URL,
  validateWebhookUrl,
  validateBotToken,
  postToWebhook,
  postWithToken,
  getStatus,
  postMessage,
};
