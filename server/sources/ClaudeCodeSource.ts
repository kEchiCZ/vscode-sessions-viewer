import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import chokidar, { type FSWatcher } from 'chokidar';
import fg from 'fast-glob';
import type { NormalizedSession, SessionOverview, SessionSource, SessionSourceSnapshot, TurnInfo } from './SessionSource.js';

interface ClaudeMessageUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ClaudeMessageContent {
  type: string;
  text?: string;
  thinking?: string;
}

interface ClaudeMessage {
  role?: string;
  content?: string | ClaudeMessageContent[];
  model?: string;
  usage?: ClaudeMessageUsage;
}

interface ClaudeEntry {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  promptId?: string;
  sessionId?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  cwd?: string;
  message?: ClaudeMessage;
}

const USD_TO_CZK = 23;

interface ModelPricing { input: number; output: number; cacheRead: number; }

// Sorted from most-specific to least-specific so first-match wins
const CLAUDE_PRICING: Array<[string, ModelPricing]> = [
  ['claude-fable-5',    { input: 10.0, output: 50.0, cacheRead: 1.00 }],
  ['claude-mythos-5',   { input: 10.0, output: 50.0, cacheRead: 1.00 }],
  ['claude-sonnet-4-6', { input:  3.0, output: 15.0, cacheRead: 0.30 }],
  ['claude-haiku-4-5',  { input:  1.0, output:  5.0, cacheRead: 0.10 }],
  ['claude-haiku-4',    { input:  1.0, output:  5.0, cacheRead: 0.10 }],
  ['claude-opus-4',     { input:  5.0, output: 25.0, cacheRead: 0.50 }],
];

function getClaudePricing(model: string): ModelPricing | undefined {
  for (const [prefix, pricing] of CLAUDE_PRICING) {
    if (model.startsWith(prefix)) return pricing;
  }
  return undefined;
}

function calcUsdCost(usage: ClaudeMessageUsage, model: string): number {
  const p = getClaudePricing(model);
  if (!p) return 0;
  const M = 1_000_000;
  return (
    (usage.input_tokens ?? 0) * p.input / M +
    (usage.output_tokens ?? 0) * p.output / M +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead / M
  );
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function minIso(current: string | undefined, candidate: string): string {
  return !current || candidate < current ? candidate : current;
}

function maxIso(current: string | undefined, candidate: string): string {
  return !current || candidate > current ? candidate : current;
}

function isToolResult(entry: ClaudeEntry): boolean {
  const content = entry.message?.content;
  if (!Array.isArray(content)) return false;
  return content.length > 0 && content.every((b) => b.type === 'tool_result');
}

function isRealUserTurn(entry: ClaudeEntry): boolean {
  if (isToolResult(entry)) return false;
  const text = extractMessageText(entry.message?.content);
  if (!text) return false;
  if (text.startsWith('<command-name>') || text.startsWith('<local-command')) return false;
  return true;
}

function extractMessageText(content: string | ClaudeMessageContent[] | undefined): string | undefined {
  if (!content) return undefined;
  if (typeof content === 'string') return content.trim() || undefined;
  if (Array.isArray(content)) {
    const texts = content
      .filter((b) => b.type === 'text' && b.text?.trim())
      .map((b) => b.text!.trim());
    return texts.join('\n').trim() || undefined;
  }
  return undefined;
}

export class ClaudeCodeSource implements SessionSource {
  private readonly pollIntervalMs: number;
  private watcher?: FSWatcher;
  private pollTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private sessions = new Map<string, NormalizedSession>();
  private sessionEntries = new Map<string, ClaudeEntry[]>();
  private lastRefreshAt?: string;
  private error?: string;
  private refreshInFlight?: Promise<void>;
  private watchedDirsKey = '';

  constructor(pollIntervalMs: number) {
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
    const entries = this.sessionEntries.get(id);
    if (!entries) return [];
    return buildTurns(entries);
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
      const projectsDir = path.join(os.homedir(), '.claude', 'projects');
      const pattern = toPosix(path.join(projectsDir, '**', '*.jsonl'));
      const files = (await fg(pattern, { onlyFiles: true, unique: true, dot: true, suppressErrors: true }))
        .filter((f) => !f.includes('/subagents/'));

      await this.updateWatcher(files);

      const newSessions = new Map<string, NormalizedSession>();
      const newEntries = new Map<string, ClaudeEntry[]>();

      for (const filePath of files) {
        const id = path.basename(filePath, '.jsonl');
        const entries: ClaudeEntry[] = [];
        await readJsonl(filePath, (entry) => {
          entries.push(entry as ClaudeEntry);
        });
        const session = await buildSession(id, filePath, entries);
        if (session) {
          newSessions.set(id, session);
          newEntries.set(id, entries);
        }
      }

      this.sessions = newSessions;
      this.sessionEntries = newEntries;
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

async function buildSession(id: string, filePath: string, entries: ClaudeEntry[]): Promise<NormalizedSession | undefined> {
  const hasMessages = entries.some((e) => e.type === 'user' || e.type === 'assistant');
  if (!hasMessages) return undefined;

  let startTime: string | undefined;
  let updatedAt: string | undefined;
  let cwd: string | undefined;
  let firstUserMessage: string | undefined;
  let messageCount = 0;
  let userTurnCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalUsdCost = 0;
  let assistantCount = 0;
  const models = new Set<string>();

  for (const entry of entries) {
    if (entry.timestamp) {
      startTime = minIso(startTime, entry.timestamp);
      updatedAt = maxIso(updatedAt, entry.timestamp);
    }
    if (entry.cwd && !cwd) {
      cwd = entry.cwd;
    }

    if (entry.type === 'user' && !entry.isMeta && !entry.isSidechain && isRealUserTurn(entry)) {
      messageCount++;
      userTurnCount++;
      if (!firstUserMessage && entry.message) {
        const text = extractMessageText(entry.message.content);
        if (text && !text.startsWith('<local-command') && !text.startsWith('<command-name')) {
          firstUserMessage = text.slice(0, 280);
        }
      }
    } else if (entry.type === 'assistant') {
      messageCount++;
      assistantCount++;
      if (entry.message) {
        if (entry.message.model) models.add(entry.message.model);
        const usage = entry.message.usage;
        if (usage) {
          totalInputTokens += usage.input_tokens ?? 0;
          totalOutputTokens += usage.output_tokens ?? 0;
          totalCachedTokens += usage.cache_read_input_tokens ?? 0;
          if (entry.message.model) totalUsdCost += calcUsdCost(usage, entry.message.model);
        }
      }
    }
  }

  if (!updatedAt) {
    try {
      const stats = await fs.stat(filePath);
      updatedAt = stats.mtime.toISOString();
      startTime ??= updatedAt;
    } catch {
      updatedAt = new Date(0).toISOString();
    }
  }

  const workspaceName = cwd ? path.basename(cwd) : undefined;

  return {
    id,
    workspaceStorageId: id,
    workspaceName,
    product: 'Claude Code',
    sourcePaths: { transcript: filePath },
    startTime,
    updatedAt,
    producer: 'Claude Code CLI',
    firstUserMessage,
    messageCount,
    userTurnCount,
    agents: [],
    tools: [],
    hasDebugLog: false,
    cost: {
      inputTokens: totalInputTokens || undefined,
      outputTokens: totalOutputTokens || undefined,
      cachedTokens: totalCachedTokens || undefined,
      requestCount: assistantCount || undefined,
      usdCost: totalUsdCost > 0 ? totalUsdCost : undefined,
      models: [...models].sort()
    }
  };
}

function buildTurns(entries: ClaudeEntry[]): TurnInfo[] {
  const turns: TurnInfo[] = [];
  let currentMsg: ClaudeEntry | undefined;
  let assistantResponses: ClaudeEntry[] = [];
  let turnIndex = 0;

  function flush(): void {
    if (!currentMsg) return;
    const rawText = currentMsg.message ? extractMessageText(currentMsg.message.content) : undefined;
    const userMessage =
      rawText && !rawText.startsWith('<local-command') && !rawText.startsWith('<command-name')
        ? rawText.slice(0, 280)
        : undefined;

    const models = [
      ...new Set(assistantResponses.map((e) => e.message?.model).filter((m): m is string => !!m))
    ].sort();
    const inputTokens = assistantResponses.reduce((sum, e) => sum + (e.message?.usage?.input_tokens ?? 0), 0);
    const outputTokens = assistantResponses.reduce((sum, e) => sum + (e.message?.usage?.output_tokens ?? 0), 0);
    const cachedTokens = assistantResponses.reduce((sum, e) => sum + (e.message?.usage?.cache_read_input_tokens ?? 0), 0);
    const usdCost = assistantResponses.reduce((sum, e) => {
      if (e.message?.model && e.message.usage) return sum + calcUsdCost(e.message.usage, e.message.model);
      return sum;
    }, 0);

    turns.push({
      index: turnIndex++,
      userMessage,
      timestamp: currentMsg.timestamp ?? new Date(0).toISOString(),
      models,
      inputTokens,
      outputTokens,
      cachedTokens,
      usdCost: usdCost > 0 ? usdCost : undefined,
      llmRequestCount: assistantResponses.length,
      toolCalls: [],
      subTurnCount: 0,
      hasBrowserContext: false
    });
  }

  for (const entry of entries) {
    if (entry.type === 'user' && !entry.isMeta && !entry.isSidechain && isRealUserTurn(entry)) {
      flush();
      currentMsg = entry;
      assistantResponses = [];
    } else if (entry.type === 'assistant' && currentMsg) {
      assistantResponses.push(entry);
    }
  }
  flush();

  return turns;
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
