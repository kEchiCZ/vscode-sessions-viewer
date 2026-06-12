import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import chokidar, { type FSWatcher } from 'chokidar';
import fg from 'fast-glob';
import type { NormalizedSession, SessionOverview, SessionSource, SessionSourceSnapshot, TurnInfo } from './SessionSource.js';

interface RequestData {
  index: number;
  promptTokens?: number;
  outputTokens?: number;
  model?: string;
  userMessage?: string;
  completedAt?: number;
}

interface SessionData {
  id: string;
  filePath: string;
  workspaceStorageId: string;
  workspaceName?: string;
  product?: string;
  creationDate?: number;
  requests: RequestData[];
}

const USD_TO_CZK = 23;

interface ModelPricing { input: number; output: number; }

const CLAUDE_PRICING_VSCODE: Array<[string, ModelPricing]> = [
  ['claude-fable-5',    { input: 10.0, output: 50.0 }],
  ['claude-mythos-5',   { input: 10.0, output: 50.0 }],
  ['claude-sonnet-4-6', { input:  3.0, output: 15.0 }],
  ['claude-haiku-4-5',  { input:  1.0, output:  5.0 }],
  ['claude-haiku-4',    { input:  1.0, output:  5.0 }],
  ['claude-opus-4',     { input:  5.0, output: 25.0 }],
];

function getClaudePricingVscode(model: string): ModelPricing | undefined {
  for (const [prefix, pricing] of CLAUDE_PRICING_VSCODE) {
    if (model.startsWith(prefix)) return pricing;
  }
  return undefined;
}

function calcRequestUsdCost(promptTokens: number | undefined, outputTokens: number | undefined, model: string): number {
  const p = getClaudePricingVscode(model);
  if (!p) return 0;
  const M = 1_000_000;
  return ((promptTokens ?? 0) * p.input + (outputTokens ?? 0) * p.output) / M;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function friendlyProductName(dirName: string): string {
  const map: Record<string, string> = {
    Code: 'VS Code',
    'Code - Insiders': 'VS Code Insiders',
    'Code - Exploration': 'VS Code Exploration',
    VSCodium: 'VSCodium',
    'VSCodium - Insiders': 'VSCodium Insiders',
    Cursor: 'Cursor',
    'Cursor Nightly': 'Cursor Nightly',
    Windsurf: 'Windsurf',
    'Windsurf - Next': 'Windsurf Next',
    Antigravity: 'Antigravity',
    Devin: 'Devin',
    Trae: 'Trae',
    'Trae CN': 'Trae CN',
    Positron: 'Positron'
  };
  return map[dirName] ?? dirName;
}

function extractProduct(filePath: string): string | undefined {
  const parts = toPosix(filePath).split('/');
  for (const storageDir of ['workspaceStorage', 'globalStorage']) {
    const index = parts.lastIndexOf(storageDir);
    if (index >= 2 && parts[index - 1] === 'User') {
      return friendlyProductName(parts[index - 2]);
    }
  }
  return undefined;
}

function extractWorkspaceStorageId(filePath: string): string {
  const parts = toPosix(filePath).split('/');
  const wsIndex = parts.lastIndexOf('workspaceStorage');
  if (wsIndex >= 0 && parts[wsIndex + 1]) return parts[wsIndex + 1];
  // For globalStorage paths, use the session file's own basename as the ID
  return path.basename(filePath, '.jsonl');
}

async function resolveWorkspaceName(filePath: string): Promise<string | undefined> {
  const parts = toPosix(filePath).split('/');
  const index = parts.lastIndexOf('workspaceStorage');
  if (index < 0 || !parts[index + 1]) return undefined;
  try {
    const workspaceJsonPath = `${parts.slice(0, index + 2).join('/')}/workspace.json`;
    const raw = await fs.readFile(workspaceJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const uri = (parsed.folder ?? parsed.workspace) as string | undefined;
    if (!uri) return undefined;
    const decoded = decodeURIComponent(uri.replace(/^file:\/\//, ''));
    return path.basename(decoded.replace(/\.code-workspace$/, ''));
  } catch {
    return undefined;
  }
}

function extractUserMessage(result: Record<string, unknown>): string | undefined {
  try {
    const meta = result.metadata as Record<string, unknown> | undefined;
    if (!meta) return undefined;
    const msgs = meta.renderedUserMessage;
    if (!Array.isArray(msgs)) return undefined;
    const textPart = msgs.find(
      (p: unknown) => p && typeof p === 'object' && (p as Record<string, unknown>).type === 1
    ) as Record<string, unknown> | undefined;
    if (!textPart) return undefined;
    const text = typeof textPart.text === 'string' ? textPart.text : '';
    const match = /<userRequest>([\s\S]*?)<\/userRequest>/i.exec(text);
    if (match) return match[1].trim().slice(0, 280);
    // Fallback: strip context blocks and use the remaining text
    const stripped = text
      .replace(/<context>[\s\S]*?<\/context>/gi, '')
      .replace(/<reminderInstructions>[\s\S]*?<\/reminderInstructions>/gi, '')
      .replace(/<workspace_info>[\s\S]*?<\/workspace_info>/gi, '')
      .replace(/<environment_info>[\s\S]*?<\/environment_info>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();
    return stripped.slice(0, 280) || undefined;
  } catch {
    return undefined;
  }
}

function extractModel(result: Record<string, unknown>): string | undefined {
  // Check result.resolvedModel, result.metadata.resolvedModel, and toolCallRounds[*].modelId
  if (typeof result.resolvedModel === 'string' && result.resolvedModel) return result.resolvedModel;
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return undefined;
  if (typeof meta.resolvedModel === 'string' && meta.resolvedModel) return meta.resolvedModel;
  if (Array.isArray(meta.toolCallRounds)) {
    for (let i = meta.toolCallRounds.length - 1; i >= 0; i--) {
      const round = meta.toolCallRounds[i] as Record<string, unknown>;
      if (typeof round.modelId === 'string' && round.modelId) return round.modelId;
    }
  }
  return undefined;
}

async function parseSessionFile(filePath: string): Promise<SessionData | undefined> {
  const id = path.basename(filePath, '.jsonl');
  const workspaceStorageId = extractWorkspaceStorageId(filePath);
  const workspaceName = await resolveWorkspaceName(filePath);
  const product = extractProduct(filePath);

  let creationDate: number | undefined;
  const requests = new Map<number, RequestData>();

  await readJsonl(filePath, (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const rec = entry as Record<string, unknown>;
    const kind = rec.kind;

    if (kind === 0) {
      const v = rec.v as Record<string, unknown> | undefined;
      if (v && typeof v.creationDate === 'number') {
        creationDate = v.creationDate;
      }
    } else if (kind === 1) {
      const k = rec.k;
      const v = rec.v as Record<string, unknown> | undefined;
      if (!Array.isArray(k) || k.length < 3) return;
      if (k[0] !== 'requests') return;
      const idx = typeof k[1] === 'string' ? parseInt(k[1], 10) : typeof k[1] === 'number' ? k[1] : NaN;
      if (!Number.isFinite(idx)) return;

      const req = requests.get(idx) ?? { index: idx };

      if (k[2] === 'result' && v) {
        req.promptTokens = (v.metadata as Record<string, unknown> | undefined)?.['promptTokens'] as number | undefined;
        req.outputTokens = (v.metadata as Record<string, unknown> | undefined)?.['outputTokens'] as number | undefined;
        req.model = extractModel(v);
        req.userMessage = extractUserMessage(v);
      } else if (k[2] === 'modelState' && v && typeof v.completedAt === 'number') {
        req.completedAt = v.completedAt;
      }

      requests.set(idx, req);
    }
  });

  const validRequests = [...requests.values()]
    .filter((r) => r.promptTokens !== undefined || r.outputTokens !== undefined || r.completedAt !== undefined)
    .sort((a, b) => a.index - b.index);

  if (validRequests.length === 0 && !creationDate) return undefined;

  return { id, filePath, workspaceStorageId, workspaceName, product, creationDate, requests: validRequests };
}

function buildNormalizedSession(data: SessionData): NormalizedSession {
  const totalInputTokens = data.requests.reduce((sum, r) => sum + (r.promptTokens ?? 0), 0);
  const totalOutputTokens = data.requests.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0);
  const models = [...new Set(data.requests.map((r) => r.model).filter((m): m is string => !!m))].sort();
  const totalUsdCost = data.requests.reduce((sum, r) => {
    if (r.model) return sum + calcRequestUsdCost(r.promptTokens, r.outputTokens, r.model);
    return sum;
  }, 0);

  const completedAts = data.requests.map((r) => r.completedAt).filter((t): t is number => t !== undefined);
  const updatedAtMs = completedAts.length > 0 ? Math.max(...completedAts) : undefined;
  const startAtMs = data.creationDate ?? (completedAts.length > 0 ? Math.min(...completedAts) : undefined);

  const updatedAt = updatedAtMs ? new Date(updatedAtMs).toISOString() : (startAtMs ? new Date(startAtMs).toISOString() : new Date(0).toISOString());
  const startTime = startAtMs ? new Date(startAtMs).toISOString() : undefined;

  const firstUserMessage = data.requests[0]?.userMessage;

  return {
    id: data.id,
    workspaceStorageId: data.workspaceStorageId,
    workspaceName: data.workspaceName,
    product: data.product,
    sourcePaths: { transcript: data.filePath },
    startTime,
    updatedAt,
    producer: 'VS Code Built-in Chat',
    firstUserMessage,
    messageCount: data.requests.length * 2,
    userTurnCount: data.requests.length,
    agents: [],
    tools: [],
    hasDebugLog: false,
    cost: {
      inputTokens: totalInputTokens || undefined,
      outputTokens: totalOutputTokens || undefined,
      requestCount: data.requests.length || undefined,
      usdCost: totalUsdCost > 0 ? totalUsdCost : undefined,
      models
    }
  };
}

async function readJsonl(filePath: string, onEntry: (entry: unknown) => void): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    return;
  }
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      onEntry(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }
}

export class VsCodeChatSessionsSource implements SessionSource {
  private readonly workspaceStorageRoots: string[];
  private readonly pollIntervalMs: number;
  private watcher?: FSWatcher;
  private pollTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private sessions = new Map<string, NormalizedSession>();
  private sessionRequests = new Map<string, RequestData[]>();
  private lastRefreshAt?: string;
  private error?: string;
  private refreshInFlight?: Promise<void>;
  private watchedDirsKey = '';

  constructor(workspaceStorageRoots: string[], pollIntervalMs: number) {
    this.workspaceStorageRoots = workspaceStorageRoots;
    this.pollIntervalMs = pollIntervalMs;
  }

  async start(): Promise<void> {
    await this.refresh();
    this.pollTimer = setInterval(() => this.scheduleRefresh(), this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    clearTimeout(this.refreshTimer);
    clearInterval(this.pollTimer);
    await this.watcher?.close();
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

  async getSessionTurns(id: string): Promise<TurnInfo[]> {
    const requests = this.sessionRequests.get(id);
    if (!requests) return [];
    return requests.map((req) => {
      const usdCost = req.model ? calcRequestUsdCost(req.promptTokens, req.outputTokens, req.model) : 0;
      return {
        index: req.index,
        userMessage: req.userMessage,
        timestamp: req.completedAt ? new Date(req.completedAt).toISOString() : new Date(0).toISOString(),
        models: req.model ? [req.model] : [],
        inputTokens: req.promptTokens ?? 0,
        outputTokens: req.outputTokens ?? 0,
        cachedTokens: 0,
        usdCost: usdCost > 0 ? usdCost : undefined,
        llmRequestCount: 1,
        toolCalls: [],
        subTurnCount: 0,
        hasBrowserContext: false
      };
    });
  }

  async getSessionOverview(_id: string): Promise<SessionOverview | undefined> {
    return undefined;
  }

  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 350);
  }

  private async refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.performRefresh().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  private async performRefresh(): Promise<void> {
    try {
      const patterns: string[] = [];
      for (const root of this.workspaceStorageRoots) {
        // workspaceStorage/*/chatSessions/*.jsonl  (existing)
        patterns.push(toPosix(path.join(root, '*', 'chatSessions', '*.jsonl')));
        // globalStorage/emptyWindowChatSessions/*.jsonl  (VS Code Insiders / Windsurf empty-window sessions)
        const globalRoot = path.join(path.dirname(root), 'globalStorage');
        patterns.push(toPosix(path.join(globalRoot, 'emptyWindowChatSessions', '*.jsonl')));
        // globalStorage/*/chatSessions/*.jsonl  (catch any other per-extension chat storage)
        patterns.push(toPosix(path.join(globalRoot, '*', 'chatSessions', '*.jsonl')));
      }
      const files = await fg(patterns, { onlyFiles: true, unique: true, dot: true, suppressErrors: true });

      await this.updateWatcher(files);

      const newSessions = new Map<string, NormalizedSession>();
      const newRequests = new Map<string, RequestData[]>();

      for (const filePath of files) {
        const data = await parseSessionFile(filePath);
        if (data) {
          newSessions.set(data.id, buildNormalizedSession(data));
          newRequests.set(data.id, data.requests);
        }
      }

      this.sessions = newSessions;
      this.sessionRequests = newRequests;
      this.lastRefreshAt = new Date().toISOString();
      this.error = undefined;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.lastRefreshAt = new Date().toISOString();
    }
  }

  private async updateWatcher(files: string[]): Promise<void> {
    const dirs = [...new Set(files.map((f) => path.dirname(f)))].sort();
    const key = dirs.join('\n');
    if (key === this.watchedDirsKey) return;
    this.watchedDirsKey = key;
    await this.watcher?.close();
    if (dirs.length === 0) return;
    this.watcher = chokidar.watch(dirs, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
    });
    this.watcher.on('add', () => this.scheduleRefresh());
    this.watcher.on('change', () => this.scheduleRefresh());
    this.watcher.on('unlink', () => this.scheduleRefresh());
  }
}
