/**
 * Read-only profile photo for the main Profile hero
 * (Profile UI/UX Correction, Ezat 2026-11-05).
 *
 * The hero picture is display-only: no button, no file
 * input, no camera badge, no caption. Changing the photo
 * happens exclusively on /profile/edit, which renders the
 * existing AvatarUpload control (same upload action, same
 * storage path). The paint is the shared
 * `.itg2-profile-avatar` ring — one visual treatment, two
 * components: this presentational one and the upload
 * control.
 */
export function AvatarDisplay({
  avatarUrl,
  name,
}: {
  avatarUrl: string | null;
  name: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="itg2-profile-avatar shrink-0">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="Your profile photo" />
      ) : (
        <span aria-hidden="true" className="itg2-profile-avatar-fallback">
          {initials || "?"}
        </span>
      )}
    </div>
  );
}
