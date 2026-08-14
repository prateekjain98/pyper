#!/usr/bin/env node
// Eval harness for the channel-aware /cleanup pipeline.
//
//   node eval/run.mjs                 # static only (no network): routing + prompt wiring
//   PYAI_PROXY_URL=http://localhost:8080 node eval/run.mjs   # + live output assertions
//
// Static checks (always): each case's channel resolves to the expected style key
// and the built system prompt contains the expected style directives — i.e. the
// pipeline is *configured* to produce the right behavior.
//
// Live checks (when PYAI_PROXY_URL is set): POST { text, channel } to /cleanup and
// assert heuristics on the actual cleaned output (greeting/sign-off, terseness,
// fact preservation). Exit code is non-zero if any check fails.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeChannel, applyChannelStyle } from "../channelStyles.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_PROMPT = "BASE_CLEANUP_PROMPT";
const PROXY_URL = process.env.PYAI_PROXY_URL || "";

const lines = (s) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean);
const firstLine = (s) => lines(s)[0] || "";
const lastLine = (s) => lines(s).at(-1) || "";

const GREETING_RE = /^(hi|hello|hey|dear|good (morning|afternoon|evening))\b/i;
const SIGNOFF_RE =
  /^(thanks|thank you|best|best regards|regards|kind regards|warm regards|cheers|sincerely)\b[,.!]?$/i;

// Heuristic output assertions (live mode).
const OUTPUT_CHECKS = {
  hasGreeting: (out, want) => GREETING_RE.test(firstLine(out)) === want,
  hasSignoff: (out, want) => SIGNOFF_RE.test(lastLine(out)) === want,
  isBullets: (out, want) =>
    (lines(out).filter((l) => /^[-•*]\s+/.test(l)).length >= 2) === want,
  maxLines: (out, n) => lines(out).length <= n,
  preserves: (out, tokens) => {
    const hay = String(out).toLowerCase();
    return tokens.every((t) => hay.includes(String(t).toLowerCase()));
  },
};

function runStatic(c) {
  const problems = [];
  const resolved = normalizeChannel(c.channel);
  const want = c.assert?.resolvesTo ?? "";
  if (resolved !== want) {
    problems.push(`resolvesTo: channel "${c.channel}" resolved to "${resolved}", expected "${want}"`);
  }
  const prompt = applyChannelStyle(BASE_PROMPT, c.channel).toLowerCase();
  for (const needle of c.assert?.promptIncludes ?? []) {
    if (!prompt.includes(String(needle).toLowerCase())) {
      problems.push(`promptIncludes: system prompt is missing "${needle}"`);
    }
  }
  return problems;
}

async function runLive(c) {
  const problems = [];
  const wants = c.assert?.output;
  if (!wants) return problems;
  let out;
  try {
    const resp = await fetch(`${PROXY_URL.replace(/\/$/, "")}/cleanup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: c.rawStt, channel: c.channel }),
    });
    if (!resp.ok) {
      problems.push(`live: POST /cleanup -> HTTP ${resp.status} ${(await resp.text()).slice(0, 120)}`);
      return problems;
    }
    out = (await resp.json())?.text ?? "";
  } catch (e) {
    problems.push(`live: request failed — ${e?.message || e}`);
    return problems;
  }
  for (const [key, want] of Object.entries(wants)) {
    const check = OUTPUT_CHECKS[key];
    if (!check) {
      problems.push(`live: unknown assertion "${key}"`);
      continue;
    }
    if (!check(out, want)) {
      problems.push(`live: ${key} failed — got:\n    ${String(out).replace(/\n/g, "\n    ")}`);
    }
  }
  return problems;
}

async function main() {
  const raw = JSON.parse(await readFile(path.join(HERE, "dataset.json"), "utf8"));
  const cases = raw.cases || [];
  const live = Boolean(PROXY_URL);
  console.log(
    `Channel-cleanup eval — ${cases.length} cases — mode: ${live ? `STATIC + LIVE (${PROXY_URL})` : "STATIC only"}\n`
  );

  let failed = 0;
  for (const c of cases) {
    const problems = [...runStatic(c), ...(live ? await runLive(c) : [])];
    if (problems.length) {
      failed += 1;
      console.log(`✗ ${c.id} (${c.app})`);
      for (const p of problems) console.log(`    - ${p}`);
    } else {
      console.log(`✓ ${c.id} (${c.app})${live ? "" : "  [static]"}`);
    }
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed${live ? "" : " (static)"}.`);
  if (!live) {
    console.log("Set PYAI_PROXY_URL and run a proxy (with a provider key) to check live output.");
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
