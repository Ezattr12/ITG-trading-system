# Profile photo upload crash — fix, 2026-10-29 (Digest 3390255549)

## Symptom

On the live Phase 19 build, /profile loaded correctly, but
tapping the profile picture, selecting a photo and uploading
crashed the app: "Application error: a server-side exception
has occurred" (Digest 3390255549).

## Reproduction (real Supabase, verification account)

Local production build connected to the live Supabase project,
real signed-in session, files set on the actual avatar input:

| File | Result |
|---|---|
| Valid JPEG, 52 KB | **Success** — object stored in `avatars`, `profiles.avatar_url` updated, avatar rendered and persisted after reload |
| Valid JPEG, ~1.45 MB | **Full-page crash** — Digest (local build) 3611061180 |
| Valid JPEG, ~2.94 MB | **Full-page crash** — identical; the app's own 2 MB validation never ran |
| Text file, 600 B | Graceful inline error, exactly as designed |

Server log (complete entry):

```
⨯ [Error: Body exceeded 1 MB limit.
To configure the body size limit for Server Actions, see:
https://nextjs.org/docs/app/api-reference/next-config-js/serverActions#bodysizelimit]
{ statusCode: 413, digest: '3611061180' }
```

## Root cause

Next.js Server Actions enforce a **default 1 MB request-body
limit**, and `next.config.ts` did not configure
`serverActions.bodySizeLimit`. Any avatar photo larger than
~1 MB was rejected by the framework with a **thrown** 413
*before* `uploadAvatarAction` executed, so the action's own
validation (image type, ≤ 2 MB) was unreachable, and the
unhandled error propagated through `useActionState` into the
full-page Application error.

Everything else in the pipeline was proven healthy by the
52 KB upload in the same session: client file selection, the
`avatars` bucket (public, no conflicting limits), the
`{user.id}/avatar-{timestamp}.{ext}` path, Storage RLS owner
policies, the storage upload, the `profiles.avatar_url`
update, and profile rendering. It was **not** a Storage/RLS,
bucket, path, database, or server/client boundary problem.
(Digests are build-specific; the local digest differs
numerically from production's 3390255549 — message, status
code, route and flow are identical.)

The same framework limit also sat below the **trade
screenshot** app limit (5 MB), so screenshots between 1 MB and
5 MB would have crashed the same way; the config fix covers
both.

## Fix

- `apps/web/next.config.ts`:
  `experimental.serverActions.bodySizeLimit: "10mb"` — above
  every app upload limit (avatar 2 MB, screenshots 5 MB) plus
  multipart overhead, so real files always reach the app's own
  validation. The app limits themselves are unchanged.
- `apps/web/lib/profile/avatar-validation.ts` (new): the
  avatar rules (image type, ≤ 2 MB, exact user-facing
  messages) as one shared helper — the single source of truth.
- `apps/web/lib/auth/actions.ts`: `uploadAvatarAction` now
  uses the shared helper (identical behavior/messages), and
  calls `revalidatePath("/profile")` on success so the new
  photo appears **immediately** (previously it only appeared
  after the next navigation/reload).
- `apps/web/components/profile/avatar-upload.tsx`: the file
  picker runs the same shared validation before submitting —
  an invalid or oversize file now shows the inline error
  instantly and is never uploaded. No visual/design change:
  same classes, same status line, same states.
- Tests: `lib/profile/avatar-validation.test.ts` — boundary
  tests for the shared validation (0 B, exactly 2 MB, 2 MB+1,
  non-image) plus a config guard asserting the framework body
  limit stays above the largest app upload limit (5 MB), so
  this crash class cannot silently return.

**Storage/RLS changes: none.** The bucket and its policies
were verified correct against the live project and were not
touched. No design, calculation, auth-architecture, or
trade-logic changes.
