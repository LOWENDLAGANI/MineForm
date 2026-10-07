"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

const input = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 sm:text-sm";
const label = "block text-xs font-medium text-zinc-600";

export function SharePanel({
  slug, published, saving, onSlugChange, linkExpiresAt, onExpiryChange,
}: {
  slug: string;
  published: boolean;
  saving: boolean;
  onSlugChange: (slug: string) => void;
  linkExpiresAt: string | null;
  onExpiryChange: (iso: string | null) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [slugDraft, setSlugDraft] = useState(slug);

  useEffect(() => setSlugDraft(slug), [slug]);

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/f/${slug}` : `/f/${slug}`;

  useEffect(() => {
    if (!published) { setQrDataUrl(null); return; }
    QRCode.toDataURL(publicUrl, { width: 320, margin: 2, color: { dark: "#09090b", light: "#ffffff" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [published, publicUrl]);

  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  const shareText = encodeURIComponent("Fill in this form:");
  const shareUrl = encodeURIComponent(publicUrl);

  const socials = [
    { name: "X / Twitter", href: `https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}` },
    { name: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}` },
    { name: "WhatsApp", href: `https://wa.me/?text=${shareText}%20${shareUrl}` },
  ];

  const embedCode = `<iframe src="${publicUrl}?embed=1" width="100%" height="640" style="border:0;border-radius:12px" title="Form" loading="lazy"></iframe>`;

  const expiryValue = linkExpiresAt ? linkExpiresAt.slice(0, 10) : "";

  return (
    <div className="space-y-4">
      <section>
        <label className={label} htmlFor="s-slug">Custom link</label>
        <div className="mt-1 flex gap-2">
          <span className="flex items-center font-mono text-xs text-zinc-400">/f/</span>
          <input id="s-slug" value={slugDraft} disabled={saving}
            onChange={(e) => setSlugDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-"))}
            className={input} />
          <button type="button" disabled={saving || slugDraft === slug || slugDraft.length < 3}
            onClick={() => onSlugChange(slugDraft.replace(/^-+|-+$/g, ""))}
            className="shrink-0 rounded-md border border-zinc-300 px-3 text-xs font-medium text-zinc-700 hover:border-zinc-900 disabled:opacity-40">
            Save
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">Lowercase letters, numbers and dashes. Changing this breaks old links.</p>
      </section>

      <section>
        <span className={label}>Public link</span>
        <div className="mt-1 flex items-center gap-2">
          <a href={published ? `/f/${slug}` : undefined} target="_blank" rel="noreferrer"
            className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-900 hover:underline">
            {published ? publicUrl : "Publish to make the link live"}
          </a>
          <button type="button" onClick={() => copy(publicUrl, "link")} disabled={!published}
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-900 disabled:opacity-40">
            {copied === "link" ? "Copied!" : "Copy"}
          </button>
        </div>
      </section>

      {published && qrDataUrl && (
        <section>
          <span className={label}>QR code</span>
          <div className="mt-2 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="QR code for the form link" className="h-28 w-28 rounded-lg border border-zinc-200" />
            <a href={qrDataUrl} download={`qr-${slug}.png`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-900">
              Download PNG
            </a>
          </div>
        </section>
      )}

      <section>
        <span className={label}>Share on social</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {socials.map((s) => (
            <a key={s.name} href={published ? s.href : undefined} target="_blank" rel="noreferrer" aria-disabled={!published}
              className={`rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-900 ${!published ? "pointer-events-none opacity-40" : ""}`}>
              {s.name}
            </a>
          ))}
          <a href={published ? `mailto:?subject=${shareText}&body=${shareUrl}` : undefined}
            className={`rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-900 ${!published ? "pointer-events-none opacity-40" : ""}`}>
            Email invite
          </a>
        </div>
      </section>

      <section>
        <span className={label}>Embed on your site</span>
        <textarea readOnly rows={3} value={embedCode} onFocus={(e) => e.currentTarget.select()} className={`mt-1 font-mono text-[11px] ${input} resize-y`} />
        <button type="button" onClick={() => copy(embedCode, "embed")}
          className="mt-1 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-900">
          {copied === "embed" ? "Copied!" : "Copy embed code"}
        </button>
      </section>

      <section>
        <label className={label} htmlFor="s-expiry">Link expires on (optional)</label>
        <input id="s-expiry" type="date" disabled={saving} value={expiryValue}
          onChange={(e) => {
            const v = e.target.value;
            onExpiryChange(v ? new Date(`${v}T23:59:59Z`).toISOString() : null);
          }}
          className={`mt-1 ${input}`} />
        <p className="mt-1 text-[11px] text-zinc-400">After this date the public link stops accepting responses.</p>
      </section>
    </div>
  );
}
