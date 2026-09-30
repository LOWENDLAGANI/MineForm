"use client";

import { useEffect, useState } from "react";

/**
 * Branding splash shown on hard page loads only.
 *
 * Rules:
 * - The app mounts and loads silently behind the image (App Router does this
 *   for us, since the overlay renders on top of `children`).
 * - The image stays fully visible for SPLASH_HOLD_MS, then blurs + fades out.
 * - Shown once per browser session, so client-side navigation between
 *   sub-pages (viewing responses, wall, etc.) does NOT show it again.
 * - A responder opening a direct /f/[slug] link in a fresh tab still sees it.
 * - Portrait artwork is used on narrow viewports, landscape on wide ones.
 */
const SPLASH_HOLD_MS = 2000;
const SPLASH_FADE_MS = 900;
const SESSION_KEY = "mineform:splash-shown";

export default function SplashScreen() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      // Storage can be blocked (private mode, embedded webviews) — play safe
      // and skip the splash rather than showing it on every sub-page.
      seen = true;
    }
    if (seen) return;

    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }

    setVisible(true);
    document.body.style.overflow = "hidden";

    const holdTimer = window.setTimeout(() => setLeaving(true), SPLASH_HOLD_MS);
    const doneTimer = window.setTimeout(() => {
      setVisible(false);
      document.body.style.overflow = "";
    }, SPLASH_HOLD_MS + SPLASH_FADE_MS);

    return () => {
      window.clearTimeout(holdTimer);
      window.clearTimeout(doneTimer);
      document.body.style.overflow = "";
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[100] flex items-center justify-center bg-white"
      style={{
        transition: `opacity ${SPLASH_FADE_MS}ms ease-in-out, filter ${SPLASH_FADE_MS}ms ease-in-out`,
        opacity: leaving ? 0 : 1,
        filter: leaving ? "blur(18px)" : "blur(0px)",
        transform: leaving ? "scale(1.04)" : "scale(1)",
        willChange: "opacity, filter, transform",
      }}
    >
      <picture>
        <source media="(orientation: portrait)" srcSet="/brand-portrait.png" />
        <img
          src="/brand-landscape.png"
          alt="MineForm"
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      </picture>
    </div>
  );
}
