import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { NormalizedSession, SessionOverview, SessionSource, SessionSourceSnapshot, TurnInfo } from './SessionSource.js';

interface DevinSessionRow {
  id: string;
  working_directory?: string;
  model?: string;
  agent_mode?: string;
  created_at?: number;
  last_activity_at?: number;
  title?: string;
  cogs_json?: string;
  workspace_dirs?: string;
}

function resolveDbPath(): string | undefined {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  const p = path.join(appData, 'devin', 'cli', 'sessions.db');
  return existsSync(p) ? p : undefined;
}

export class DevinSource implements SessionSource {
  private sessions = new Map<string, NormalizedSession>();
  private lastRefreshAt?: string;
  private error?: string;
  private pollTimer?: NodeJS.Timeout;

  constructor(
    private readonly dbPath: string,
    private readonly pollIntervalMs: number
  ) {}

  static create(pollIntervalMs: number): DevinSource | undefined {
    const p = resolveDbPath();
    return p ? new DevinSource(p, pollIntervalMs) : undefined;
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
      const tmpPath = path.join(os.tmpdir(), 'sessions_viewer_devin.db');
      await fs.copyFile(this.dbPath, tmpPath);

      const db = new Database(tmpPath, { readonly: true });
      const rows = db
        .prepare('SELECT * FROM sessions ORDER BY last_activity_at DESC')
        .all() as DevinSessionRow[];
      db.close();

      const newSessions = new Map<string, NormalizedSession>();

      for (const row of rows) {
        const workspacePath = row.working_directory ?? undefined;
        const workspaceName = workspacePath ? path.basename(workspacePath) : undefined;

        const updatedAt = row.last_activity_at
          ? new Date(row.last_activity_at).toISOString()
          : row.created_at
            ? new Date(row.created_at).toISOString()
            : new Date(0).toISOString();

        const startTime = row.created_at ? new Date(row.created_at).toISOString() : undefined;
        const models = row.model ? [row.model] : [];

        newSessions.set(row.id, {
          id: row.id,
          workspaceStorageId: row.id,
          workspaceName,
          product: 'Devin',
          sourcePaths: { transcript: this.dbPath },
          startTime,
          updatedAt,
          producer: 'Devin',
          firstUserMessage: row.title ?? undefined,
          messageCount: 0,
          userTurnCount: 0,
          agents: [],
          tools: [],
          hasDebugLog: false,
          cost: { models }
        });
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
