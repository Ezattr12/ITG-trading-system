"use client";

import { useActionState, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { uploadAvatarAction, type ActionResult } from "@/lib/auth/actions";

/**
 * Premium profile-photo interaction (Phase 19).
 *
 * Replaces the browser "Choose File / No file chosen" form with a
 * large circular avatar that is itself the control: tap it (camera
 * badge), pick an image, and the upload starts immediately.
 * Upload goes through the existing `uploadAvatarAction` — same
 * server validation (image only, ≤ 2 MB, rate-limited) and the
 * same secure Supabase Storage behaviour (private `avatars`
 * bucket, RLS, path under the trader's own id). No security
 * change: this is presentation only.
 */
export function AvatarUpload({
  avatarUrl,
  name,
  configured,
}: {
  avatarUrl: string | null;
  name: string;
  configured: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    uploadAvatarAction,
    { ok: false },
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    formRef.current?.requestSubmit();
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <form ref={formRef} action={formAction} encType="multipart/form-data">
        <input
          ref={inputRef}
          name="avatar"
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Choose a new profile photo"
          disabled={pending || !configured}
          onChange={onFileChange}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending || !configured}
          aria-label={avatarUrl ? "Change profile photo" : "Add a profile photo"}
          className="itg-avatar group block cursor-pointer outline-none transition-transform duration-150 ease-standard hover:scale-[1.03] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="Your profile photo" />
          ) : (
            <span aria-hidden="true" className="itg-avatar-fallback">
              {initials || "?"}
            </span>
          )}
          <span
            aria-hidden="true"
            className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-gradient-to-br from-violet-500 to-primary text-white shadow-elevation-2 transition-transform duration-150 ease-standard group-hover:scale-110"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
          </span>
        </button>
      </form>
      <p className="min-h-5 text-center text-xs text-muted-foreground" aria-live="polite">
        {pending
          ? `Uploading${fileName ? ` ${fileName}` : ""}…`
          : state.ok && state.message
            ? state.message
            : state.error
              ? state.error
              : configured
                ? "Tap the photo to change it"
                : "Photo upload needs Supabase connected"}
      </p>
      {state.ok && state.message && (
        <p role="status" className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Photo updated
        </p>
      )}
    </div>
  );
}
