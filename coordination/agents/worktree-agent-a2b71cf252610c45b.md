---
agent: worktree-agent-a2b71cf252610c45b
branch: worktree-agent-a2b71cf252610c45b
status: working
updated: 2026-08-14T00:00:00Z
auto: true
---

## Now
Fixing desktop auto-redeploy so pyper.work reflects main. Pushed CI fixes (e611c27), triggered auto-release run 31743553713.

## Uncommitted changes
- (clean)

## Fixes & gotchas (others should apply)
- **publish-downloads was a SILENT NO-OP → the GCS download stayed stale even after a green build — FIXED (495a87b).**
  It ran `gh release download "$RELEASE_TAG"`, but electron-builder publishes a **DRAFT** release
  (`releaseType: draft` in electron-builder.json) and a `contents:read` GITHUB_TOKEN **cannot see
  draft releases** → "release not found" → zero files. The `|| true` + empty `for f in *.dmg`
  loops masked it as SUCCESS. `Pyper-latest-arm64.dmg` never changed generation. Fix: build jobs
  now `actions/upload-artifact@v4` (names `pyper-installers-*`); publish-downloads
  `actions/download-artifact@v4` (same-run, runtime token — no release/permission dependency) and
  **exits 1 if it mirrors 0 files**. If you touch publish-downloads, keep it artifact-based, not
  release-based. (`gh release upload` from build-macos works because that job has `contents:write`,
  which CAN see the draft — only the read side was broken.)
- **Auto-release was `startup_failure` on EVERY run since 77e5fb2 — FIXED (e611c27).**
  `release.yml`'s new `publish-downloads` job declares `permissions: id-token: write`, but the
  caller `auto-release-desktop.yml` only granted `contents: write`. A reusable workflow can't
  request more permission than its caller grants → GitHub rejects it at startup ("workflow file
  issue"), so prepare/tests/builds NEVER ran. Fix: added `id-token: write` to
  `auto-release-desktop.yml` permissions. **If you add a permission to any job in `release.yml`,
  also grant it in `auto-release-desktop.yml`.**
- **build-macos hard-failed on Apple code-signing — there are ZERO CI secrets** (`gh api
  repos/.../actions/secrets` → total_count:0; no APPLE_*, AZURE_*, GOOGLE_CALENDAR_* configured).
  The "Setup macOS Code Signing" step did `security import` of an empty cert → fail → whole
  release fails → `publish-downloads` (needs the 3 builds) never runs. Fix (e611c27): when
  `APPLE_CERTIFICATE_BASE64` is empty, build ad-hoc + un-notarized
  (`electron-builder --config.mac.identity=- --config.mac.hardenedRuntime=false --config.mac.notarize=false`)
  — the electron-builder-26 keyless path (see `MacTargetHelper.js`; identity `"-"` = ad-hoc,
  identity `null` = unsigned/"damaged"). A `codesign -dv` guard refuses to publish an unsigned app.
- **build-windows will still FAIL** (Azure Trusted Signing needs AZURE_* secrets). That's why
  `publish-downloads` now runs on `if: ${{ !cancelled() }}` — it mirrors whatever DID build (macOS
  DMG, Linux AppImage) even if Windows fails. To make Windows green, add AZURE_TENANT_ID/CLIENT_ID/
  CLIENT_SECRET or add a `-c.win.azureSignOptions` skip like the macOS ad-hoc branch.
- **GCS publish is keyless — no secret needed.** The repo's WIF principalSet
  (`.../attribute.repository/prateekjain98/pyper`) holds `roles/storage.admin` on `pyper-services`,
  which owns `gs://pyper-desktop-downloads` (public: allUsers objectViewer). Same
  `google-github-actions/auth@v2` (no `service_account`) as `deploy-proxy.yml`.
- **The site (pyper.work, Vercel) serves `Pyper-latest-arm64.dmg`** from that bucket (77e5fb2 →
  `useDownload.ts`). `publish-downloads` overwrites that stable alias each release. Un-notarized →
  first-open is "unidentified developer / Open Anyway" (install-guide.tsx already documents this).
- **To make the download signed+notarized:** add APPLE_CERTIFICATE_BASE64/_PASSWORD,
  APPLE_API_KEY_BASE64/_ID, APPLE_API_ISSUER, APPLE_TEAM_ID repo secrets — the workflow already
  uses them when present.
