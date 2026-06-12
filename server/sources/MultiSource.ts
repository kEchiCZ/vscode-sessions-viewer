import type { NormalizedSession, SessionOverview, SessionSource, SessionSourceSnapshot, TurnInfo } from './SessionSource.js';

function sessionScore(s: NormalizedSession): number {
  if (s.cost.aiCredits !== undefined) return 3;
  if (s.cost.inputTokens !== undefined || s.cost.outputTokens !== undefined) return 2;
  if (s.userTurnCount > 0) return 1;
  return 0;
}

export class MultiSource implements SessionSource {
  private readonly sources: SessionSource[];
  // Maps session ID → the source that won deduplication
  private ownerMap = new Map<string, SessionSource>();

  constructor(sources: SessionSource[]) {
    this.sources = sources;
  }

  async start(): Promise<void> {
    await Promise.all(this.sources.map((s) => s.start()));
  }

  async stop(): Promise<void> {
    await Promise.all(this.sources.map((s) => s.stop()));
  }

  listSessions(): SessionSourceSnapshot {
    const snapshots = this.sources.map((s) => ({ source: s, snap: s.listSessions() }));

    // Deduplicate by ID: prefer sessions with richer data (AIC > tokens > anything)
    const seen = new Map<string, NormalizedSession>();
    const newOwners = new Map<string, SessionSource>();

    for (const { source, snap } of snapshots) {
      for (const session of snap.sessions) {
        const existing = seen.get(session.id);
        if (!existing || sessionScore(session) > sessionScore(existing)) {
          seen.set(session.id, session);
          newOwners.set(session.id, source);
        }
      }
    }

    this.ownerMap = newOwners;
    const sessions = [...seen.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const errors = snapshots.map(({ snap }) => snap.error).filter(Boolean);
    const lastRefreshAt = snapshots
      .map(({ snap }) => snap.lastRefreshAt)
      .filter((t): t is string => !!t)
      .sort()
      .at(-1);

    return {
      sessions,
      lastRefreshAt,
      error: errors.length > 0 ? errors.join('; ') : undefined
    };
  }

  getSession(id: string): NormalizedSession | undefined {
    // Prefer the pre-computed owner if available; fall back to first-found otherwise.
    const owner = this.ownerMap.get(id);
    if (owner) return owner.getSession(id);
    // ownerMap not yet built — scan all sources and return the richest result
    let best: NormalizedSession | undefined;
    for (const source of this.sources) {
      const s = source.getSession(id);
      if (s && (!best || sessionScore(s) > sessionScore(best))) best = s;
    }
    return best;
  }

  private ownerFor(id: string): SessionSource | undefined {
    const mapped = this.ownerMap.get(id);
    if (mapped) return mapped;
    let bestScore = -1;
    let best: SessionSource | undefined;
    for (const source of this.sources) {
      const s = source.getSession(id);
      if (s) {
        const score = sessionScore(s);
        if (score > bestScore) { bestScore = score; best = source; }
      }
    }
    return best;
  }

  async getSessionTurns(id: string): Promise<TurnInfo[]> {
    return this.ownerFor(id)?.getSessionTurns(id) ?? [];
  }

  async getSessionOverview(id: string): Promise<SessionOverview | undefined> {
    return this.ownerFor(id)?.getSessionOverview(id);
  }
}
