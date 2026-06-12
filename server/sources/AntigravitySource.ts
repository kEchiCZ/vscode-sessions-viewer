import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { NormalizedSession, SessionOverview, SessionSource, SessionSourceSnapshot, TurnInfo } from './SessionSource.js';

interface TaskMetadata {
  summary?: string;
  updatedAt?: string;
}

function resolveGeminiDir(): string | undefined {
  const home = os.homedir();
  const p = path.join(home, '.gemini', 'antigravity');
  return existsSync(p) ? p : undefined;
}

function extractWorkspaceName(content: string): string | undefined {
  // file:///d:/Documents/Visual%20Studio%20Code/ProjectName/...
  const fileUrlMatch = content.match(/file:\/\/\/([a-zA-Z][:/][^)\s"'`\n]+)/);
  if (fileUrlMatch) {
    const decoded = decodeURIComponent(fileUrlMatch[1]).replace(/\\/g, '/');
    const parts = decoded.split('/').filter(Boolean);
    // Expect: d:, Documents, Visual Studio Code, ProjectName, ...
    if (parts.length >= 4) return parts[3];
  }

  // Backtick Windows path: `D:\Documents\Visual Studio Code\ProjectName`
  const backtickMatch = content.match(/`([A-Za-z]:\\[^`\n]+)`/);
  if (backtickMatch) {
    const parts = backtickMatch[1].replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length >= 4) return parts[3];
  }

  return undefined;
}

export class AntigravitySource implements SessionSource {
  private readonly brainDir: string;
  private readonly annotationsDir: string;
  private sessions = new Map<string, NormalizedSession>();
  private lastRefreshAt?: string;
  private error?: string;
  private pollTimer?: NodeJS.Timeout;

  constructor(
    private readonly geminiAntigravityDir: string,
    private readonly pollIntervalMs: number
  ) {
    this.brainDir = path.join(geminiAntigravityDir, 'brain');
    this.annotationsDir = path.join(geminiAntigravityDir, 'annotations');
  }

  static create(pollIntervalMs: number): AntigravitySource | undefined {
    const p = resolveGeminiDir();
    return p ? new AntigravitySource(p, pollIntervalMs) : undefined;
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
      let brainEntries: string[] = [];
      try {
        brainEntries = await fs.readdir(this.brainDir);
      } catch {
        // brainDir doesn't exist yet
      }

      const newSessions = new Map<string, NormalizedSession>();

      for (const sessionId of brainEntries) {
        if (sessionId === 'tempmediaStorage') continue;
        const sessionDir = path.join(this.brainDir, sessionId);

        let updatedAt: string | undefined;
        let summary: string | undefined;

        try {
          const metaRaw = await fs.readFile(path.join(sessionDir, 'task.md.metadata.json'), 'utf8');
          const meta = JSON.parse(metaRaw) as TaskMetadata;
          updatedAt = meta.updatedAt;
          summary = meta.summary;
        } catch {
          // no metadata file
        }

        let firstUserMessage: string | undefined;
        let workspaceName: string | undefined;

        try {
          const taskContent = await fs.readFile(path.join(sessionDir, 'task.md'), 'utf8');
          const h1Match = taskContent.match(/^#\s+(.+)$/m);
          if (h1Match) firstUserMessage = h1Match[1].trim().slice(0, 280);
          workspaceName = extractWorkspaceName(taskContent);
        } catch {
          // no task.md
        }

        // Also try implementation_plan.md for workspace if not found yet
        if (!workspaceName) {
          try {
            const planContent = await fs.readFile(path.join(sessionDir, 'implementation_plan.md'), 'utf8');
            workspaceName = extractWorkspaceName(planContent);
          } catch {
            // no implementation_plan.md
          }
        }

        // Fallback timestamp from annotation pbtxt
        if (!updatedAt) {
          try {
            const annotRaw = await fs.readFile(
              path.join(this.annotationsDir, `${sessionId}.pbtxt`),
              'utf8'
            );
            const secMatch = annotRaw.match(/seconds:(\d+)/);
            if (secMatch) {
              updatedAt = new Date(parseInt(secMatch[1], 10) * 1000).toISOString();
            }
          } catch {
            // no annotation
          }
        }

        // Skip sessions with no usable data
        if (!updatedAt && !firstUserMessage && !summary) continue;

        newSessions.set(sessionId, {
          id: sessionId,
          workspaceStorageId: sessionId,
          workspaceName,
          product: 'Antigravity',
          sourcePaths: { transcript: path.join(sessionDir, 'task.md') },
          startTime: undefined,
          updatedAt: updatedAt ?? new Date(0).toISOString(),
          producer: 'Google Antigravity',
          firstUserMessage: firstUserMessage ?? summary,
          messageCount: 0,
          userTurnCount: 0,
          agents: [],
          tools: [],
          hasDebugLog: false,
          cost: { models: [] }
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
