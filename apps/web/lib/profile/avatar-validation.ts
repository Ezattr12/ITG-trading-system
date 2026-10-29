/**
 * Avatar file validation (shared by the server action and the
 * profile-photo client component — one source of truth for the
 * rules and their messages).
 *
 * Rules (unchanged product rules): an image file, at most 2 MB.
 * The server action remains the authoritative check; the client
 * runs the same check before submitting so an invalid file gets
 * the inline error immediately instead of a wasted upload.
 *
 * Note on the 2026-10-29 production crash (Digest 3390255549):
 * the framework's Server Action body limit (default 1 MB) sat
 * BELOW this 2 MB app limit, so any photo between 1 MB and
 * 2 MB was rejected by Next.js with a thrown 413 before this
 * validation could ever run, crashing the page. The framework
 * limit is now configured above every app upload limit in
 * next.config.ts (`serverActions.bodySizeLimit`), and this
 * validation is what real files are judged by.
 */

export const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;

export interface AvatarFileLike {
  type: string;
  size: number;
}

/**
 * Returns the user-facing error for an unacceptable avatar
 * file, or null when the file is acceptable. `file` is null
 * when the form carried no file at all.
 */
export function avatarFileError(file: AvatarFileLike | null): string | null {
  if (!file || file.size === 0) return "Choose an image file first.";
  if (!file.type.startsWith("image/")) {
    return "Only image files can be used as a profile photo.";
  }
  if (file.size > MAX_AVATAR_SIZE_BYTES) {
    return "Profile photo must be 2 MB or smaller.";
  }
  return null;
}
