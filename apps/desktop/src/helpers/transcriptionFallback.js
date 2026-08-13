// Where a streaming session's batch fallback goes. The Pyper Cloud batch
// endpoint (the proxy's /transcribe) needs no sign-in or credits, so a cloud
// session that drops to fallback should always recover there — including when
// signed out. (The old "skip" for signed-out was a stale gate from before the
// no-auth proxy; it silently discarded already-recorded audio.) Only BYOK mode
// routes to the user's own provider, so a cloud user's audio never crosses over.
export function resolveStreamingFallbackTarget({ useLocalWhisper, cloudTranscriptionMode }) {
  const isCloudMode = !useLocalWhisper && cloudTranscriptionMode === "pyper";
  if (isCloudMode) return "cloud";
  return "byok";
}
