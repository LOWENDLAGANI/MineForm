"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { HeaderBar } from "@/components/app/HeaderBar";

interface WaitingRoomStatus {
  enabled: boolean;
  maxActive: number;
  activeCount: number;
  submittedCount: number;
  totalActive: number;
  spotsLeft: number;
  queueLength: number;
  waitingRoomOpen: boolean;
}

export default function WaitingRoomPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params.slug;

  const [status, setStatus] = useState<WaitingRoomStatus | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [localQueuePosition, setLocalQueuePosition] = useState<number | null>(null);

  // Session ID for this waiting room entry (stored in URL params or generated)
  const sessionId = useRef<string | null>(null);

  // Initialize session ID from URL or generate new one
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    let sid = urlParams.get("session");
    if (!sid) {
      sid = crypto.randomUUID();
      // Redirect to add session param
      window.history.replaceState(null, "", `${window.location.pathname}?session=${sid}`);
    }
    sessionId.current = sid;
  }, []);

  // Fetch waiting room status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/forms/${slug}/waiting-room`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("Form not found");
          return;
        }
        throw new Error("Failed to fetch status");
      }
      const data = await res.json();
      setStatus(data);

      // If we have a session ID, check our position
      if (sessionId.current) {
        const positionRes = await fetch(`/api/public/forms/${slug}/waiting-room`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId.current }),
        });
        if (positionRes.ok) {
          // We need to get position from the queue directly
          const posRes = await fetch(`/api/public/forms/${slug}/waiting-room`);
          if (posRes.ok) {
            const posData = await posRes.json();
            // The position is in the queue - we need to find ours
            // For now, we'll estimate based on queue length
            const estimatedPosition = posData.queueLength > 0 ? posData.queueLength : null;
            setLocalQueuePosition(estimatedPosition);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to check waiting room");
    } finally {
      setChecking(false);
    }
  }, [slug]);

  // Poll for status updates
  useEffect(() => {
    fetchStatus();

    // Poll every 5 seconds while waiting
    const interval = setInterval(() => {
      if (!status?.waitingRoomOpen && !status?.spotsLeft) {
        // If spots are available, try to proceed
        fetchStatus();
      } else {
        // Still waiting - check status
        fetchStatus();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [slug, fetchStatus, status]);

  // Try to enter the form when spots become available
  const tryEnter = useCallback(async () => {
    if (!sessionId.current) return;

    try {
      // Try to start the form with our waiting room session
      const res = await fetch(`/api/public/forms/${slug}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waitingRoomSessionId: sessionId.current }),
      });

      if (res.ok) {
        // Successfully admitted! Redirect to the form
        const data = await res.json();
        router.push(`/f/${slug}?resume=${data.response.recoveryToken}`);
        return;
      }

      const errorData = await res.json().catch(() => null);
      if (res.status === 429 && errorData?.error?.code === "WAITING_ROOM") {
        // Still in waiting room - update our status
        await fetchStatus();
        return;
      }

      if (res.status === 401 && errorData?.error?.code === "WAITING_ROOM_SESSION_EXPIRED") {
        setError("Your waiting room session expired. Please refresh the page.");
        return;
      }

      setError(errorData?.error?.message ?? "Could not enter the form");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enter form");
    }
  }, [slug, router, fetchStatus]);

  // Auto-try to enter when spots open up
  useEffect(() => {
    if (status && status.spotsLeft > 0 && sessionId.current) {
      // We have spots available - try to enter!
      tryEnter();
    }
  }, [status, tryEnter]);

  // Handle leaving the waiting room
  const handleLeave = useCallback(async () => {
    if (!sessionId.current) return;

    try {
      const res = await fetch(`/api/public/forms/${slug}/waiting-room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current }),
      });

      if (res.ok) {
        // Successfully left - redirect to form page (will show closed message if still capped)
        router.push(`/f/${slug}`);
      }
    } catch (e) {
      console.error("Failed to leave waiting room:", e);
    }
  }, [slug, router]);

  return (
    <div className="min-h-screen bg-white">
      <HeaderBar />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 place-items-center rounded-full bg-blue-50 text-3xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-zinc-900 sm:text-3xl">You&apos;re in the waiting room</h1>
          <p className="mt-3 text-base text-zinc-500">
            This form is popular! You&apos;re in a queue and will be admitted automatically when a spot opens up.
          </p>

          {error && (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {checking && (
            <div className="mt-8 flex items-center justify-center gap-2 text-sm text-zinc-500">
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Checking your position…
            </div>
          )}

          {status && !checking && (
            <div className="mt-8 space-y-6">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-center">
                <div className="text-4xl font-bold text-zinc-900">
                  {status.spotsLeft > 0 ? (
                    <span className="text-emerald-600">{status.spotsLeft}</span>
                  ) : (
                    <span className="text-amber-600">0</span>
                  )}
                </div>
                <div className="mt-1 text-sm text-zinc-500">
                  {status.spotsLeft > 0 ? "spots available" : "spots taken"}
                </div>
              </div>

              {status.queueLength > 0 && (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-zinc-900">#{localQueuePosition ?? status.queueLength}</div>
                    <div className="mt-1 text-sm text-zinc-500">
                      in front of you in the queue
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Active respondents</span>
                  <span className="font-medium text-zinc-900">{status.totalActive}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Submitted</span>
                  <span className="font-medium text-zinc-900">{status.submittedCount}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Max active users</span>
                  <span className="font-medium text-zinc-900">{status.maxActive}</span>
                </div>

                {/* Visual progress bar */}
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-200">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      status.totalActive >= status.maxActive ? "bg-red-500" : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(100, (status.totalActive / status.maxActive) * 100)}%` }}
                  />
                </div>
              </div>

              {status.waitingRoomOpen && status.queueLength > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  You&apos;re #{localQueuePosition ?? "?"} in line. We&apos;ll admit you automatically when a spot opens up.
                </div>
              )}

              {/* Auto-admission indicator */}
              <div className="flex items-center justify-center gap-2 text-sm text-zinc-500">
                <svg className="h-5 w-5 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
                Waiting for your turn…
              </div>

              <button
                type="button"
                onClick={handleLeave}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900"
              >
                Leave the queue
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
