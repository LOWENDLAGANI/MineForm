"use client";

// Dashboard footer — one large "Support" button linking to the donation
// page. NEXT_PUBLIC_SUPPORT_URL overrides the default; setting it to
// "off" hides the footer entirely.

const DEFAULT_SUPPORT_URL = "https://sociabuzz.com/minetallestmc/tribe";

export function SupportFooter() {
  const url = process.env.NEXT_PUBLIC_SUPPORT_URL ?? DEFAULT_SUPPORT_URL;
  if (!url || url === "off") return null;

  return (
    <footer className="border-t border-zinc-100 bg-zinc-50/60">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-8 sm:px-6">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-full bg-emerald-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-emerald-600/25 transition-all hover:bg-emerald-700 active:scale-[0.99] sm:w-auto"
        >
          ❤️ Support MineForm
        </a>
        <span className="text-xs text-zinc-400">MineForm</span>
      </div>
    </footer>
  );
}
