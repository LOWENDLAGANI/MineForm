"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase-browser";

export function HeaderBar() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-zinc-900">MineForm</span>
          <span className="h-4 w-px bg-zinc-200" />
          <span className="text-xs text-zinc-400">Forms</span>
        </div>
        <div className="flex items-center gap-3">
          {email && (
            <span className="font-mono text-xs text-zinc-500">{email}</span>
          )}
          <button
            type="button"
            onClick={async () => {
              const supabase = getBrowserSupabase();
              if (supabase) await supabase.auth.signOut();
              router.push("/login");
              router.refresh();
            }}
            className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
