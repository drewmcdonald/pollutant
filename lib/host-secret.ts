/**
 * Generates a cryptographically strong, URL-safe host secret entirely
 * client-side. The backend (`convex/events.ts`) only ever sees and stores a
 * SHA-256 hash of this value, so it must be generated here and handed to the
 * host once — there is no server-side recovery path.
 *
 * 32 random bytes base64url-encode to 43 characters, comfortably clearing
 * the backend's 32-character minimum (`MIN_HOST_SECRET_LENGTH`).
 */
const SECRET_BYTES = 32;

export function generateHostSecret(): string {
  const bytes = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return `h_${base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
