/**
 * Access control helpers: password hashing, link expiry, country/device
 * allowlists. Runs server-side only (Next.js API routes).
 */

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface AccessCheckInput {
  access_config: {
    password_hash?: string | null;
    link_expires_at?: string | null;
    allowed_countries?: string[];
    allowed_devices?: ("mobile" | "desktop")[];
  } | null;
}

export function isLinkExpired(cfg: AccessCheckInput["access_config"]): boolean {
  const at = cfg?.link_expires_at;
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && Date.now() > t;
}

export function hasPassword(cfg: AccessCheckInput["access_config"]): boolean {
  return typeof cfg?.password_hash === "string" && cfg.password_hash.length > 0;
}

export async function verifyPassword(cfg: AccessCheckInput["access_config"], candidate: string | null): Promise<boolean> {
  if (!hasPassword(cfg)) return true;
  if (!candidate) return false;
  return (await sha256Hex(candidate)) === cfg?.password_hash;
}

export function detectDevice(userAgent: string | null): "mobile" | "desktop" {
  return /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|Opera Mini/i.test(userAgent ?? "")
    ? "mobile"
    : "desktop";
}

export interface GeoDeviceVerdict {
  ok: boolean;
  code?: "FORBIDDEN_COUNTRY" | "FORBIDDEN_DEVICE";
  message?: string;
}

/**
 * Country / device allowlist check. On Vercel the country arrives in the
 * `x-vercel-ip-country` header; when the header is absent (local dev,
 * self-host) the country check passes rather than locking everyone out.
 */
export function checkGeoDevice(
  cfg: AccessCheckInput["access_config"],
  headers: Headers,
): GeoDeviceVerdict {
  const countries = cfg?.allowed_countries ?? [];
  if (countries.length > 0) {
    const ipCountry =
      headers.get("x-vercel-ip-country") ?? headers.get("cf-ipcountry") ?? null;
    if (ipCountry && !countries.includes(ipCountry.toUpperCase())) {
      return { ok: false, code: "FORBIDDEN_COUNTRY", message: "This form isn't available in your region." };
    }
  }

  const devices = cfg?.allowed_devices ?? [];
  if (devices.length > 0) {
    const device = detectDevice(headers.get("user-agent"));
    if (!devices.includes(device)) {
      return {
        ok: false,
        code: "FORBIDDEN_DEVICE",
        message: device === "mobile" ? "Open this form on a computer." : "Open this form on your phone.",
      };
    }
  }

  return { ok: true };
}
