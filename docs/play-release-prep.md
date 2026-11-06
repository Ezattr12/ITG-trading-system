# Google Play Release Preparation — Record

**Date:** 2026-11-06 · **Mandate:** prepare the first official Play release; publish nothing, change no paid accounts, keep package `com.itg.traderos`, no secrets in GitHub, never claim a policy requirement satisfied without evidence.

## Deliverables (built + verified)

| Item | State |
|---|---|
| Production AAB (signed with upload key) | `itg-traderos-release.aab`, 69,089,777 B, **SHA-256 `ace81ed9d716d28d4d5951e11f8a390deeffb997ae5093a5ac6d0fbe59fd1a32`** (held outside the repo with the release assets) |
| CI build | GitHub Actions run 42251133529, commit cffe223a, **success**; bundletool 1.17.2 `validate` passed in CI; CI builds UNSIGNED by design (no secrets in GitHub) — signing is local |
| Badging evidence (from the CI universal APK) | package `com.itg.traderos`, **versionCode 1, versionName 1.0.0, targetSdk 36**, compileSdk 37, minSdk 24 |
| Final merged permissions | INTERNET, READ_EXTERNAL_STORAGE (maxSdk 32), USE_BIOMETRIC, USE_FINGERPRINT, VIBRATE, DYNAMIC_RECEIVER. **Absent: CAMERA, RECORD_AUDIO, SYSTEM_ALERT_WINDOW, WRITE_EXTERNAL_STORAGE** (blocked in app.json + image-picker camera/mic disabled — camera was never used in code) |
| Signing | Upload key RSA-2048, alias `upload`, DN CN=ITG TraderOS / O=Institutional Trading Group / C=US. **Upload certificate SHA-256: `90:96:42:9A:DA:49:87:91:44:80:37:C8:85:72:D8:6A:EB:32:28:DC:30:90:E0:49:4A:4B:F0:5A:9B:81:B5:A0`**. Signed bundle verified: `jarsigner -verify` → "jar verified", exit 0; certificate fingerprint in the signed file matches the keystore |
| Key custody | Keystore + password live OUTSIDE the repo in a 0700/0600 directory on this machine only. **Owner action: back both up into a personal password manager.** Losing them requires a Play upload-key reset (Google identity verification). Play App Signing will hold the app-signing key; this is the upload key |
| Privacy Policy | LIVE: https://itg-traderos.vercel.app/privacy (200, verified in production smoke) |
| Account deletion URL | LIVE: https://itg-traderos.vercel.app/delete-account (200) + in-app deletion (Profile → Delete account, password re-confirmation) + signed-in web deletion (Edit Profile danger zone) + admin processing queue. Migration 0023 (`account_deletion_requests`, RLS on, zero client policies) |
| Data Safety | Answer key prepared from a verified table-by-table inventory (no location/health/messages/contacts/audio collected; no data shared; encrypted in transit; deletion available) — entered in Console by the owner |
| Store listing | Name/short/full descriptions drafted from real features only; icon 512 + feature graphic rendered from the brand system; **screenshots still required from the real release build on a real device** (never mocked) |
| Reviewer access | Test account A designated; credentials go only into the Console's secure field, never into documents |

## Test evidence
- Web: Vitest 1057/1057, e2e 36/36, typecheck + lint clean, security check 463 files, production build clean.
- Local QA 22/22 on the new pages incl. a real form submission and an admin processing cycle on throwaways; production smoke passed post-deploy (deployment dpl_DnMNupvBQTDj5ZcrM3PQof81E3LQ).
- Deletion E2E (throwaway): storage objects in both buckets removed, auth user + cascaded rows deleted, audit rows retained with nulled links (disclosed in the policy); baselines restored exactly (4 users, 16 trades, 0 deletion requests).
- Mobile: tsc clean, `expo export` exit 0 with the new delete-account screen in the bundle.

## What remains (all owner-side, by design)
1. Back up the upload keystore + password (custody, above).
2. Play Developer account ($25 + identity verification) → create the app → enrol in Play App Signing → confirm the upload fingerprint matches the one above.
3. Choose the support email (also completes the /privacy contact line).
4. Enter the listing, Data Safety answers, privacy + deletion URLs, content rating (18+, no gambling with real money), app-access credentials (account A).
5. Upload the AAB to **Internal Testing** first; complete the device acceptance pass (the M2 checklist applies); **Closed Testing with ≥12 testers for 14 consecutive days** is required for new personal developer accounts before production access.
6. Production rollout only on the owner's explicit approval — nothing in this preparation publishes anything.
