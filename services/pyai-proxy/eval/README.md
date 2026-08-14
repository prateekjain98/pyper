# Cleanup pipeline — spec & eval

How raw speech-to-text becomes finished text for a given target app, and a dataset
that pins the expected behavior so we can check the cloud pipeline against it.

## The pipeline

```
mic ──▶ STT (transcribe)        raw transcript, verbatim + disfluencies
     ──▶ channel detection      which app is this going into? (client side)
     ──▶ POST /cleanup          { text, channel }  ── this service
           ├─ systemPromptFor(channel)             base cleanup + target-app rewrite
           └─ provider waterfall (Cerebras → Ollama → Anthropic → OpenAI → Groq)
     ──▶ cleaned text ──▶ paste at the cursor
```

1. **STT** produces a raw transcript (fillers, run-ons, no punctuation).
2. **Channel detection** (in the desktop app / demo) resolves the *target app* — a
   native bundle id, or a browser's active-tab URL host — to a channel name.
3. **`POST /cleanup { text, channel }`** builds a two-part system prompt via
   [`../channelStyles.js`](../channelStyles.js):
   - the **base cleanup** rules (fix fillers/grammar/punctuation, never answer or
     execute the dictated content, preserve every fact/name/number), and
   - an optional **target-app rewrite** that *overrides* "output the transcript
     verbatim" so the text reads naturally for where it's going.
   The request waterfalls through configured providers; any one failing (out of
   credits, rate-limit, down) falls through to the next.

## Channels

`channelStyles.js` is the single source of truth. Callers may send an alias
(`email`, `outlook`, `teams`, `notion`, `vscode`, …) — `normalizeChannel` maps it
onto a style key. Unknown/empty → base cleanup (no rewrite).

| Channel | Aliases | Behavior |
|---|---|---|
| `gmail` | email, outlook, mail, spark | Formal email — professional, complete sentences, **adds a greeting + sign-off** even if not dictated |
| `slack` | chat, teams, discord, messages, whatsapp, telegram | Casual chat — conversational, short, **no** greeting/sign-off |
| `notes` | note, notion, obsidian, bear | Terse notes — shortest form, bullets for lists, drop pleasantries |
| `docs`  | doc, document, google docs, word | Clean document prose — full sentences/paragraphs, no email framing |
| `code`  | editor, ide, vscode, terminal | Terse technical comment — imperative, identifiers verbatim |
| *(default)* | anything unknown/empty | Plain cleanup, no rewrite |

## The dataset

[`dataset.json`](dataset.json) — one case per row:

- `channel` — what the caller sends (often an alias).
- `rawStt` — realistic raw transcript.
- `expected` — an illustrative target output (human reference, not asserted verbatim).
- `assert`:
  - `resolvesTo` — the style key `channel` must normalize to (`""` = base). *(static)*
  - `promptIncludes` — substrings the built system prompt must contain. *(static)*
  - `output` — heuristics on the **actual** `/cleanup` output. *(live)*
    `hasGreeting`, `hasSignoff`, `isBullets`, `maxLines`, `preserves: [tokens]`.

## Running the eval

```bash
# Static — routing + prompt wiring, no network, no keys:
node eval/run.mjs

# Live — also POSTs each case to a running proxy and checks the real output:
PYAI_PROXY_URL=http://localhost:8080 node eval/run.mjs
```

For a live run, start the proxy with at least one cleanup provider key configured
(e.g. `GROQ_API_KEY=… PORT=8080 node server.js`). Exit code is non-zero on any
failure, so it drops straight into CI.
