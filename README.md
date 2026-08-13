# Pyper

Privacy-first voice-to-text dictation with AI agents, meeting transcription, and notes — for macOS, Windows, and Linux.

Press a hotkey, speak, and your words appear at your cursor. Choose fully private offline transcription (local Whisper / NVIDIA Parakeet) or cloud processing for speed.


## Monorepo layout

This repository is a [Turborepo](https://turbo.build/repo) managed with npm workspaces.

```
pyper/
├── apps/
│   ├── desktop/   # Electron desktop app (React 19 + Vite + Tailwind v4 + TypeScript)
│   └── web/       # Marketing site (Next.js, App Router)
├── package.json   # workspace root
└── turbo.json     # task pipeline
```

## Getting started

Requires **Node ≥ 24**.

```bash
npm install
```

### Run an app

```bash
# Desktop app (Electron) — first run downloads native ASR binaries
npm run desktop        # or: npx turbo run dev --filter=@pyper/desktop

# Marketing site (Next.js) — http://localhost:3000
npm run web            # or: npx turbo run dev --filter=@pyper/web
```

### Common tasks (run across all apps via Turborepo)

```bash
npm run build          # build every app
npm run lint           # lint every app
npm run typecheck      # typecheck every app
```

## Apps

| App | Path | Stack | Notes |
|-----|------|-------|-------|
| Desktop | [`apps/desktop`](apps/desktop) | Electron 41, React 19, Vite, Tailwind v4 | The dictation app. See its own README for build/packaging details. |
| Web | [`apps/web`](apps/web) | Next.js (App Router) | Marketing site. |

## License

[MIT](LICENSE).
