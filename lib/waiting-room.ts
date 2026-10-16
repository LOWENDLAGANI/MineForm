/**
 * Waiting room system — in-memory only, no Supabase/VM.
 *
 * Solves the Supabase concurrent connection limit (50 active users) by:
 *  1. Tracking active respondents per form (started but not submitted) with TTL
 *  2. When a form hits its cap, new users enter a FIFO waiting queue
 *  3. When someone submits/exits, the next waiting user is admitted
 *  4. Each form can have its own waiting room config (max active, wait timeout)
 *
 * IMPORTANT: This is in-memory state. On Vercel/serverless, state is per-instance
 * and resets on cold start. For a single-instance deployment or low-traffic forms,
 * this is sufficient. For multi-instance, you'd need Redis (but that defeats the
 * "no external dependency" goal).
 *
 * The design guarantees:
 *  - No user gets kicked mid-form: once admitted, they stay until they submit/exit
 *  - No double-admission: each sessionId is unique per waiting room entry
 *  - Graceful degradation: if waiting room is disabled/misconfigured, falls back to
 *    normal cap rejection
 */

export interface WaitingRoomConfig {
  /** Whether the waiting room is enabled for this form */
  enabled: boolean;
  /** Maximum concurrent active users allowed (0 = no waiting room, use form cap only) */
  maxActive: number;
  /** How long a user can wait in the queue before giving up (ms) */
  waitTimeoutMs: number;
  /** How long a user is considered "active" after starting (ms) - TTL for cleanup */
  activeUserTtlMs: number;
}

export interface WaitingRoomEntry {
  /** Unique session ID for this waiting room entry */
  sessionId: string;
  /** Form ID this entry is for */
  formId: string;
  /** Position in queue (1-based) when entered */
  position: number;
  /** Timestamp when they entered the queue */
  enteredAt: number;
  /** Estimated time they'll be admitted (updated as people ahead submit) */
  estimatedAdmission: number;
  /** Whether they've been admitted (got a response slot) */
  admitted: boolean;
}

export interface ActiveUserRecord {
  /** Form ID */
  formId: string;
  /** Response ID (from Supabase) - the user's in-progress response */
  responseId: string;
  /** When they started */
  startedAt: number;
  /** Last activity timestamp (for TTL cleanup) */
  lastActiveAt: number;
  /** User agent for device tracking (optional, for debugging) */
  userAgent?: string;
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

/** Active users per form: formId -> Map of responseId -> ActiveUserRecord */
const activeUsers = new Map<string, Map<string, ActiveUserRecord>>();

/** Waiting queues per form: formId -> WaitingRoomEntry[] */
const waitingQueues = new Map<string, WaitingRoomEntry[]>();

/** Waiting room sessions (admitted users waiting to start): formId -> Map of sessionId -> session info */
const waitingSessions = new Map<string, Map<string, WaitingSessionInfo>>();

/** Admitted slots per form: formId -> Set of responseIds that have been admitted from queue */
const admittedSlots = new Map<string, Set<string>>();

/** Waiting room configs keyed by formId */
const configs = new Map<string, WaitingRoomConfig>();

// Cleanup interval - runs every 30 seconds
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    // Clean up expired active users
    for (const [formId, users] of activeUsers) {
      let changed = false;
      for (const [responseId, record] of users) {
        if (now - record.lastActiveAt > 5 * 60 * 1000) {
          // 5 minutes inactivity = expired
          users.delete(responseId);
          if (users.size === 0) {
            activeUsers.delete(formId);
          }
          changed = true;
        }
      }
      if (changed && users.size === 0) {
        activeUsers.delete(formId);
      }
    }

    // Clean up expired waiting queue entries
    for (const [formId, queue] of waitingQueues) {
      let changed = false;
      for (let i = queue.length - 1; i >= 0; i--) {
        const entry = queue[i];
        if (!entry) continue;
        const config = configs.get(formId);
        const timeout = config?.waitTimeoutMs ?? 10 * 60 * 1000;
        if (now - entry.enteredAt > timeout) {
          queue.splice(i, 1);
          // Clean up session
          const sessions = waitingSessions.get(formId);
          if (sessions) {
            sessions.delete(entry.sessionId);
          }
          changed = true;
        }
      }
      if (changed && queue.length === 0) {
        waitingQueues.delete(formId);
      }
    }
  }, 30_000);
}

// Start cleanup on module load
startCleanup();

// ---------------------------------------------------------------------------
// Config management
// ---------------------------------------------------------------------------

/** Set or update the waiting room config for a form */
export function setWaitingRoomConfig(formId: string, config: Partial<WaitingRoomConfig>) {
  const existing = configs.get(formId) ?? {
    enabled: false,
    maxActive: 0,
    waitTimeoutMs: 10 * 60 * 1000, // 10 minutes default
    activeUserTtlMs: 30 * 60 * 1000, // 30 minutes default
  };
  configs.set(formId, { ...existing, ...config });
}

/** Get the waiting room config for a form */
export function getWaitingRoomConfig(formId: string): WaitingRoomConfig {
  return configs.get(formId) ?? {
    enabled: false,
    maxActive: 0,
    waitTimeoutMs: 10 * 60 * 1000,
    activeUserTtlMs: 30 * 60 * 1000,
  };
}

// ---------------------------------------------------------------------------
// Active user tracking
// ---------------------------------------------------------------------------

/** Record that a user has started filling a form */
export function recordActiveUser(formId: string, responseId: string, userAgent?: string): void {
  if (!activeUsers.has(formId)) {
    activeUsers.set(formId, new Map());
  }
  const now = Date.now();
  activeUsers.get(formId)!.set(responseId, {
    formId,
    responseId,
    startedAt: now,
    lastActiveAt: now,
    userAgent,
  });
}

/** Update last activity timestamp for a user (call periodically while they're filling) */
export function touchActiveUser(formId: string, responseId: string): void {
  const users = activeUsers.get(formId);
  if (!users) return;
  const record = users.get(responseId);
  if (record) {
    record.lastActiveAt = Date.now();
  }
}

/** Remove a user from active tracking (called when they submit or exit) */
export function removeActiveUser(formId: string, responseId: string): boolean {
  const users = activeUsers.get(formId);
  if (!users) return false;
  const removed = users.delete(responseId);
  if (users.size === 0) {
    activeUsers.delete(formId);
  }
  return removed;
}

/** Get current active user count for a form */
export function getActiveUserCount(formId: string): number {
  return activeUsers.get(formId)?.size ?? 0;
}

/** Get all active user records for a form */
export function getActiveUsers(formId: string): ActiveUserRecord[] {
  const users = activeUsers.get(formId);
  if (!users) return [];
  return Array.from(users.values());
}

// ---------------------------------------------------------------------------
// Waiting room queue management
// ---------------------------------------------------------------------------

/** Generate a unique session ID */
function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Get the waiting queue for a form (readonly) */
export function getWaitingQueue(formId: string): WaitingRoomEntry[] {
  return waitingQueues.get(formId) ?? [];
}

/** Get or create the sessions map for a form */
function getSessions(formId: string): Map<string, WaitingSessionInfo> {
  if (!waitingSessions.has(formId)) {
    waitingSessions.set(formId, new Map());
  }
  return waitingSessions.get(formId)!;
}

/** Get or create the waiting queue for a form (internal use) */
function getQueue(formId: string): WaitingRoomEntry[] {
  if (!waitingQueues.has(formId)) {
    waitingQueues.set(formId, []);
  }
  return waitingQueues.get(formId)!;
}

/** Get a specific session's info */
export function getWaitingRoomSession(formId: string): WaitingSessionInfo | null {
  const sessions = waitingSessions.get(formId);
  // For the current session, we'd need to know the sessionId.
  // This function returns the first session found (for single-user case).
  // In practice, the caller should pass a sessionId.
  // For simplicity, we return null here and let the caller use getSessionBySessionId
  return null;
}

/** Session info stored when a user enters the waiting room */
export interface WaitingSessionInfo {
  sessionId: string;
  formId: string;
  enteredAt: number;
  position: number;
  waitUntil: number; // estimated time they can be admitted
  admitted: boolean;
}

/** Get session by sessionId */
export function getSessionBySessionId(formId: string, sessionId: string): WaitingSessionInfo | null {
  const sessions = waitingSessions.get(formId);
  if (!sessions) return null;
  return sessions.get(sessionId) ?? null;
}

/** Clear a session (called when user is admitted or gives up) */
export function clearWaitingRoomSession(formId: string, sessionId: string): boolean {
  const sessions = waitingSessions.get(formId);
  if (!sessions) return false;
  const removed = sessions.delete(sessionId);
  if (sessions.size === 0) {
    waitingSessions.delete(formId);
  }
  return removed;
}

/** Clear session by formId only (for cleanup when form changes) */
export function clearWaitingRoomSessionByForm(formId: string): void {
  waitingSessions.delete(formId);
}

/** Enter the waiting room for a form. Returns the queue entry if successful, null if the room is full/disabled. */
export function enterWaitingRoom(
  formId: string,
  cfg: WaitingRoomConfig,
): WaitingRoomEntry | null {
  if (!cfg.enabled || cfg.maxActive <= 0) {
    return null;
  }

  const queue = getQueue(formId);
  const sessions = getSessions(formId);

  // Check if already in queue
  // (In practice, each call is from a different session, so this is rare)
  const sessionId = generateSessionId();

  const now = Date.now();
  const position = queue.length + 1;

  // Estimate when this user might be admitted
  // Assume each user ahead takes ~2 minutes on average to submit
  const estimatedAdmission = now + (position * 2 * 60 * 1000);

  const entry: WaitingRoomEntry = {
    sessionId,
    formId,
    position,
    enteredAt: now,
    estimatedAdmission,
    admitted: false,
  };

  queue.push(entry);

  // Store session info
  sessions.set(sessionId, {
    sessionId,
    formId,
    enteredAt: now,
    position,
    waitUntil: estimatedAdmission,
    admitted: false,
  });

  return entry;
}

/** Check if a user can be admitted (a slot is available) */
function canAdmitUser(formId: string, cfg: WaitingRoomConfig): boolean {
  if (!cfg.enabled || cfg.maxActive <= 0) return false;
  const activeCount = getActiveUserCount(formId);
  return activeCount < cfg.maxActive;
}

/** Try to admit the next user in the queue. Returns the admitted entry or null. */
export function tryAdmitNext(formId: string): WaitingRoomEntry | null {
  const cfg = getWaitingRoomConfig(formId);
  if (!cfg.enabled || cfg.maxActive <= 0) return null;

  const queue = getQueue(formId);
  if (queue.length === 0) return null;

  // Check if we have capacity
  if (!canAdmitUser(formId, cfg)) return null;

  // Admit the first person in queue
  const next = queue[0];
  if (!next) return null;

  // Mark as admitted
  next.admitted = true;

  // Remove from queue
  queue.shift();

  // Clean up session
  const sessions = waitingSessions.get(formId);
  if (sessions) {
    sessions.delete(next.sessionId);
  }

  // If queue is now empty, clean up
  if (queue.length === 0) {
    waitingQueues.delete(formId);
  }

  return next;
}

/** Called when a user submits or leaves - triggers admission of next waiting user */
export function onUserSubmitOrExit(formId: string): void {
  // Try to admit the next person in line
  tryAdmitNext(formId);
}

/** Leave the waiting room (user gave up or was admitted) */
export function leaveWaitingRoom(formId: string, sessionId: string): boolean {
  const queue = getQueue(formId);
  const sessions = waitingSessions.get(formId);

  // Remove from queue
  const idx = queue.findIndex(e => e.sessionId === sessionId);
  if (idx !== -1) {
    queue.splice(idx, 1);
    // Update positions for everyone behind
    for (let i = idx; i < queue.length; i++) {
      const entry = queue[i];
      if (!entry) continue;
      entry.position = i + 1;
      // Recalculate estimated admission
      const newPos = i + 1;
      entry.estimatedAdmission = Date.now() + (newPos * 2 * 60 * 1000);
    }
  }

  // Remove session
  if (sessions) {
    sessions.delete(sessionId);
  }

  if (queue.length === 0) {
    waitingQueues.delete(formId);
  }

  if (sessions && sessions.size === 0) {
    waitingSessions.delete(formId);
  }

  return idx !== -1;
}

/** Get current queue position for a session */
export function getQueuePosition(formId: string, sessionId: string): number | null {
  const queue = getQueue(formId);
  const entry = queue.find(e => e.sessionId === sessionId);
  return entry?.position ?? null;
}

/** Check if a session has been admitted */
export function isSessionAdmitted(formId: string, sessionId: string): boolean {
  const sessions = waitingSessions.get(formId);
  if (!sessions) return false;
  const session = sessions.get(sessionId);
  return session?.admitted ?? false;
}

// ---------------------------------------------------------------------------
// Active response count (combines Supabase submitted count + in-memory active)
// ---------------------------------------------------------------------------


