"use client";

/**
 * Dashboard — dense table of the caller's forms. Rows: title / slug /
 * responses / published toggle / created. Flat zinc borders, no cards.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { HeaderBar } from "@/components/app/HeaderBar";
import { SetupNotice } from "@/components/app/SetupNotice";
import { getBrowserSupabase, supabaseEnvMissing } from "@/lib/supabase-browser";

interface FormRow {
  id: string;
  title: string;
  slug: string;
  is_published: boolean;
  response_cap: number | null;
  created_at: string;
}

const input =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-1 focus:ring-inset focus:ring-zinc-900 sm:py-1.5 sm:text-sm";

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<FormRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const authedGet = useCallback(async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.push("/login");
      return;
    }
    const res = await fetch("/api/forms", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    const body = await res.json();
    setForms(body.forms ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    authedGet();
  }, [authedGet]);

  if (supabaseEnvMissing) return <SetupNotice />;

  async function createForm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || `form-${Date.now()}`;

    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const res = await fetch("/api/forms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: title.trim(), slug }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Could not create form");
      return;
    }
    setTitle("");
    setCreating(false);
    authedGet();
  }

  async function togglePublish(form: FormRow) {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    await fetch(`/api/forms/${form.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_published: !form.is_published }),
    });
    authedGet();
  }

  async function deleteForm(form: FormRow) {
    if (!confirm(`Delete "${form.title}" and all its responses?`)) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    await fetch(`/api/forms/${form.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    authedGet();
  }

  return (
    <div className="min-h-screen bg-white">
      <HeaderBar />

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-medium text-zinc-900 sm:text-sm">Your forms</h1>
          <button
            type="button"
            onClick={() => setCreating(!creating)}
            className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 sm:px-3 sm:py-1.5 sm:text-xs"
          >
            {creating ? "Cancel" : "+ New form"}
          </button>
        </div>

        {creating && (
          <form onSubmit={createForm} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Form title"
              required
              maxLength={300}
              className={`${input} flex-1`}
            />
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800 sm:border sm:border-zinc-900 sm:bg-white sm:px-3 sm:py-1.5 sm:text-xs sm:text-zinc-900 sm:hover:bg-zinc-50"
            >
              Create
            </button>
          </form>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <div className="mt-6">
          {/* Desktop table header */}
          <div className="hidden grid-cols-[1fr_10rem_8rem_6rem_6rem] items-center gap-2 border-b border-zinc-200 py-2 text-xs font-medium text-zinc-500 sm:grid">
            <span>Title</span>
            <span>Slug</span>
            <span>Link</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>

          {loading ? (
            <p className="py-6 text-xs text-zinc-400">Loading…</p>
          ) : forms.length === 0 ? (
            <p className="py-6 text-sm text-zinc-400">
              No forms yet. Tap “New form” to create one.
            </p>
          ) : (
            forms.map((f) => (
              <div
                key={f.id}
                className="mb-3 rounded-lg border border-zinc-200 p-4 sm:mb-0 sm:rounded-none sm:border-0 sm:border-b sm:p-0"
              >
                {/* Mobile card */}
                <div className="sm:hidden">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/forms/${f.id}`}
                      className="min-w-0 flex-1 text-base font-medium text-zinc-900"
                    >
                      {f.title}
                    </Link>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        f.is_published
                          ? "bg-zinc-900 text-white"
                          : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {f.is_published ? "Live" : "Draft"}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Link
                      href={`/forms/${f.id}`}
                      className="flex-1 rounded-md bg-zinc-900 px-3 py-2.5 text-center text-xs font-medium text-white"
                    >
                      Edit
                    </Link>
                    {f.is_published && (
                      <a
                        href={`/f/${f.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 rounded-md border border-zinc-300 px-3 py-2.5 text-center text-xs font-medium text-zinc-700"
                      >
                        Preview
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => togglePublish(f)}
                      className="flex-1 rounded-md border border-zinc-300 px-3 py-2.5 text-center text-xs font-medium text-zinc-700"
                    >
                      {f.is_published ? "Unpublish" : "Publish"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteForm(f)}
                      aria-label={`Delete ${f.title}`}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-zinc-200 text-zinc-400"
                    >
                      🗑
                    </button>
                  </div>
                </div>

                {/* Desktop row */}
                <div className="hidden grid-cols-[1fr_10rem_8rem_6rem_6rem] items-center gap-2 py-2.5 sm:grid">
                  <Link
                    href={`/forms/${f.id}`}
                    className="truncate text-sm text-zinc-900 hover:underline"
                  >
                    {f.title}
                  </Link>
                  <span className="truncate font-mono text-xs text-zinc-500">{f.slug}</span>
                  <a
                    href={`/f/${f.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-zinc-500 hover:text-zinc-900 hover:underline"
                  >
                    /f/{f.slug}
                  </a>
                  <button
                    type="button"
                    onClick={() => togglePublish(f)}
                    className={`w-fit rounded-none border px-2 py-0.5 font-mono text-xs ${
                      f.is_published
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-400 hover:border-zinc-400"
                    }`}
                  >
                    {f.is_published ? "LIVE" : "DRAFT"}
                  </button>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => deleteForm(f)}
                      className="rounded-none border border-transparent px-2 py-0.5 font-mono text-xs text-zinc-400 hover:border-zinc-200 hover:text-red-600"
                    >
                      DEL
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
