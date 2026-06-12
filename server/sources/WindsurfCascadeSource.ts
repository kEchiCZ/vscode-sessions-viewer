import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { NormalizedSession, SessionOverview, SessionSource, SessionSourceSnapshot, TurnInfo } from './SessionSource.js';

interface CascadeSessionRaw {
  sessionId?: string;
  title?: string;
  cwd?: string;
  workspaceDirs?: string[];
  updatedAt?: string;
  status?: string;
  _meta?: Record<string, unknown>;
}

function resolveDbPath(): string | undefined {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  // Windsurf was rebranded to Devin — check both
  for (const product of ['Windsurf', 'Devin']) {
    const p = path.join(appData, product, 'User', 'globalStorage', 'state.vscdb');
    if (existsSync(p)) return p;
  }
  return undefined;
}

export class WindsurfCascadeSource implements SessionSource {
  private readonly dbPath: string;
  private sessions = new Map<string, NormalizedSession>();
  private lastRefreshAt?: string;
  private error?: string;
  private pollTimer?: NodeJS.Timeout;

  constructor(dbPath: string, private readonly pollIntervalMs: number) {
    this.dbPath = dbPath;
  }

  static create(pollIntervalMs: number): WindsurfCascadeSource | undefined {
    const p = resolveDbPath();
    return p ? new WindsurfCascadeSource(p, pollIntervalMs) : undefined;
  }

  async start(): Promise<void> {
    await this.refresh();
    this.pollTimer = setInterval(() => void this.refresh(), this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    clearInterval(this.pollTimer);
  }

  listSessions(): SessionSourceSnapshot {
    return {
      sessions: [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      lastRefreshAt: this.lastRefreshAt,
      error: this.error
    };
  }

  getSession(id: string): NormalizedSession | undefined {
    return this.sessions.get(id);
  }

  async getSessionTurns(_id: string): Promise<TurnInfo[]> {
    return [];
  }

  async getSessionOverview(_id: string): Promise<SessionOverview | undefined> {
    return undefined;
  }

  private async refresh(): Promise<void> {
    try {
      const tmpPath = path.join(os.tmpdir(), 'sessions_viewer_windsurf.vscdb');
      await fs.copyFile(this.dbPath, tmpPath);

      const db = new Database(tmpPath, { readonly: true });
      const row = db
        .prepare("SELECT value FROM ItemTable WHERE key = 'windsurf.acp.metadataCache' LIMIT 1")
        .get() as { value: string } | undefined;
      db.close();

      const newSessions = new Map<string, NormalizedSession>();

      if (row) {
        const cache = JSON.parse(row.value) as Record<string, unknown>;
        // Structure: { version, sessions: [...], perSession, ... }
        const sessionList = Array.isArray(cache.sessions)
          ? (cache.sessions as unknown[])
          : Object.values(cache);
        for (const sessionData of sessionList) {
          if (!sessionData || typeof sessionData !== 'object') continue;
          const s = sessionData as CascadeSessionRaw;
          const id = s.sessionId;
          if (!id) continue;

          const title = s.title ?? undefined;
          // cwd may be a file:// URI or a plain path
          const rawCwd = s.cwd ?? undefined;
          const cwdDecoded = rawCwd
            ? decodeURIComponent(rawCwd.replace(/^file:\/\/\//, '')).replace(/\//g, path.sep)
            : undefined;
          const workspaceDirs = Array.isArray(s.workspaceDirs) ? s.workspaceDirs : [];
          const workspacePath = cwdDecoded || workspaceDirs[0];
          const workspaceName = workspacePath ? path.basename(workspacePath) : undefined;
          const createdAt = s._meta?.['cognition.ai/createdAt'] as string | undefined;
          const updatedAt = s.updatedAt ?? createdAt ?? new Date(0).toISOString();

          newSessions.set(id, {
            id,
            workspaceStorageId: id,
            workspaceName,
            product: 'Windsurf',
            sourcePaths: { transcript: this.dbPath },
            startTime: createdAt,
            updatedAt,
            producer: 'Windsurf Cascade',
            firstUserMessage: title,
            messageCount: 0,
            userTurnCount: 0,
            agents: [],
            tools: [],
            hasDebugLog: false,
            cost: { models: [] }
          });
        }
      }

      this.sessions = newSessions;
      this.lastRefreshAt = new Date().toISOString();
      this.error = undefined;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.lastRefreshAt = new Date().toISOString();
    }
  }
}
