import { AlertCircle, ArrowLeft, BarChart2, Bug, Calendar, CheckCircle2, Clock3, Coins, Database, Filter, Pencil, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface SourceFileInfo {
  transcript?: string;
  debugLog?: string;
}

interface NormalizedSession {
  id: string;
  workspaceStorageId: string;
  workspaceName?: string;
  product?: string;
  sourcePaths: SourceFileInfo;
  startTime?: string;
  updatedAt: string;
  producer: string;
  copilotVersion?: string;
  vscodeVersion?: string;
  firstUserMessage?: string;
  messageCount: number;
  userTurnCount: number;
  agents: string[];
  tools: string[];
  hasDebugLog: boolean;
  cost: {
    aiCredits?: number;
    aiCreditUnit?: 'AIC';
    aiCreditSource?: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    requestCount?: number;
    usdCost?: number;
    models: string[];
  };
}

interface ToolCallInfo {
  name: string;
  detail?: string;
}

interface TurnInfo {
  index: number;
  userMessage?: string;
  timestamp: string;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  aiCredits?: number;
  usdCost?: number;
  llmRequestCount: number;
  toolCalls: ToolCallInfo[];
  subTurnCount: number;
  hasBrowserContext: boolean;
}

interface SessionsResponse {
  sessions: NormalizedSession[];
  total: number;
  lastRefreshAt?: string;
  error?: string;
}

interface SkillInfo {
  name: string;
  description: string;
  sizeBytes: number;
}

interface AgentInfo {
  name: string;
  description: string;
}

interface ToolInfo {
  name: string;
  description: string;
  isMcp: boolean;
  mcpServer?: string;
  sizeBytes: number;
}

interface ContextSizes {
  systemPromptTotalBytes: number;
  systemPromptSkillsBytes: number;
  systemPromptAgentsBytes: number;
  toolsBytes: number;
  userPromptBytes: number;
  maxContextTokens?: number;
  model?: string;
}

interface SessionOverview {
  skills: SkillInfo[];
  agents: AgentInfo[];
  tools: ToolInfo[];
  contextSizes?: ContextSizes;
}

type LoadState = 'loading' | 'ready' | 'error';

export default function App() {
  const [sessions, setSessions] = useState<NormalizedSession[]>([]);
  const [status, setStatus] = useState<LoadState>('loading');
  const [error, setError] = useState<string>();
  const [lastRefreshAt, setLastRefreshAt] = useState<string>();
  const [query, setQuery] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState('all');
  const [detailSessionId, setDetailSessionId] = useState<string>();
  const [turns, setTurns] = useState<TurnInfo[]>();
  const [turnsLoading, setTurnsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [overview, setOverview] = useState<SessionOverview | null>();
  const [dateFrom, setDateFrom] = useState('2026-06-01');
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [notesListOpen, setNotesListOpen] = useState(false);
  const [allNotesOpen, setAllNotesOpen] = useState(false);
  const [scrollToTurn, setScrollToTurn] = useState<number>();
  const [currentView, setCurrentView] = useState<'sessions' | 'stats'>('sessions');

  async function loadSessions(showSpinner = false) {
    try {
      if (showSpinner) {
        setIsRefreshing(true);
      }
      const response = await fetch('/api/sessions');
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      const payload = (await response.json()) as SessionsResponse;
      setSessions(payload.sessions);
      setLastRefreshAt(payload.lastRefreshAt);
      setError(payload.error);
      setStatus(payload.error ? 'error' : 'ready');
    } catch (caught) {
      setStatus('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function openDetail(id: string) {
    setDetailSessionId(id);
    setTurns(undefined);
    setOverview(null);
    setTurnsLoading(true);
    try {
      const [turnsRes, overviewRes] = await Promise.all([
        fetch(`/api/sessions/${encodeURIComponent(id)}/turns`),
        fetch(`/api/sessions/${encodeURIComponent(id)}/overview`)
      ]);
      if (!turnsRes.ok) throw new Error(`API returned ${turnsRes.status}`);
      const payload = (await turnsRes.json()) as { turns: TurnInfo[] };
      setTurns(payload.turns);
      if (overviewRes.ok) {
        const ov = (await overviewRes.json()) as SessionOverview;
        setOverview(ov);
      }
    } catch {
      setTurns([]);
    } finally {
      setTurnsLoading(false);
    }
  }

  function closeDetail() {
    setDetailSessionId(undefined);
    setTurns(undefined);
    setOverview(undefined);
    setScrollToTurn(undefined);
  }

  function navigateToTurn(sessionId: string, turnIndex: number) {
    setAllNotesOpen(false);
    setScrollToTurn(turnIndex);
    void openDetail(sessionId);
  }

  useEffect(() => {
    if (scrollToTurn === undefined || !turns) return;
    const el = document.getElementById(`turn-${scrollToTurn}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setScrollToTurn(undefined);
    }
  }, [turns, scrollToTurn]);

  useEffect(() => {
    void loadSessions();
    const interval = window.setInterval(() => void loadSessions(), 5_000);
    return () => window.clearInterval(interval);
  }, []);

  const workspaces = useMemo(() => {
    const names = new Set<string>();
    sessions.forEach((session) => names.add(session.workspaceName ?? session.workspaceStorageId));
    return [...names].sort();
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const fromDate = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
    const toDate = dateTo ? new Date(dateTo + 'T23:59:59') : null;
    return sessions.filter((session) => {
      const updatedAt = new Date(session.updatedAt);
      if (fromDate && updatedAt < fromDate) return false;
      if (toDate && updatedAt > toDate) return false;
      const matchesQuery = normalizedQuery
        ? [session.id, session.workspaceStorageId, session.workspaceName, session.product, session.firstUserMessage, session.producer]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(normalizedQuery))
        : true;
      const sessionWorkspace = session.workspaceName ?? session.workspaceStorageId;
      const matchesWorkspace = workspaceFilter === 'all' || sessionWorkspace === workspaceFilter;
      return matchesQuery && matchesWorkspace;
    });
  }, [workspaceFilter, query, sessions, dateFrom, dateTo]);

  const selectedSession = filteredSessions.find((session) => session.id === selectedId) ?? filteredSessions[0];
  const selectedCost = selectedSession?.cost ?? { models: [] };
  const detailSession = sessions.find((s) => s.id === detailSessionId);
  const totalKc = filteredSessions.reduce((sum, s) => {
    if (s.cost.aiCredits !== undefined) return sum + s.cost.aiCredits / 4.8;
    if (s.cost.usdCost !== undefined) return sum + s.cost.usdCost * 23;
    return sum;
  }, 0);

  if (detailSessionId && detailSession) {
    const detailCost = detailSession.cost ?? { models: [] };
    return (
      <main className="app-shell">
        <section className="toolbar detail-toolbar" aria-label="Session detail toolbar">
          <button type="button" className="back-button" onClick={closeDetail}>
            <ArrowLeft size={17} aria-hidden="true" />
            Back to sessions
          </button>
          <div className="detail-title-block">
            <h1>{detailSession.firstUserMessage ?? detailSession.id}</h1>
            <span>{detailSession.producer} &middot; {formatDateTime(detailSession.updatedAt)}</span>
          </div>
          <div className="detail-toolbar-right">
            <div className="cost-summary-pill">
              <Coins size={15} aria-hidden="true" />
              {detailCost.aiCredits !== undefined
                ? <strong>{formatAic(detailCost.aiCredits)} AIC <span className="kc-price">({aicToKc(detailCost.aiCredits)} Kč)</span></strong>
                : detailCost.usdCost !== undefined
                ? <strong><span className="kc-price">{usdToKc(detailCost.usdCost)} Kč</span></strong>
                : <span>No cost data</span>}
            </div>
          </div>
        </section>

        {notesListOpen && turns && (
          <NotesListModal sessionId={detailSessionId} turns={turns} onClose={() => setNotesListOpen(false)} />
        )}

        <section className="turns-area">
          {overview && <SessionOverviewPanel overview={overview} />}
          {turnsLoading ? (
            <StateMessage title="Loading turns" detail="Parsing JSONL log file…" />
          ) : turns && turns.length === 0 ? (
            <StateMessage title="No turns found" detail="This session has no debug log or no user messages were recorded." />
          ) : turns ? (
            <div className="turns-list">
              {turns.map((turn) => (
                <TurnCard key={turn.index} turn={turn} sessionId={detailSessionId} />
              ))}
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="toolbar" aria-label="Sessions toolbar">
        <div className="title-block">
          <div className="title-row">
            <Database size={22} aria-hidden="true" />
            <h1>VS Code Sessions</h1>
          </div>
          <p>Local Copilot Chat transcripts and debug logs</p>
        </div>

        <div className="toolbar-actions">
          <div className="status-pill" title="Backend refresh status">
            {status === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{status === 'loading' ? 'Loading' : status === 'error' ? 'Needs attention' : 'Live'}</span>
          </div>
          <button type="button" className="icon-button" onClick={() => setAllNotesOpen(true)} title="Všechny poznámky">
            <Pencil size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`icon-button${currentView === 'stats' ? ' icon-button--active' : ''}`}
            onClick={() => setCurrentView(currentView === 'stats' ? 'sessions' : 'stats')}
            title="Statistiky"
          >
            <BarChart2 size={18} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" onClick={() => void loadSessions(true)} title="Refresh sessions">
            <RefreshCw size={18} className={isRefreshing ? 'spin' : undefined} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="filters" aria-label="Session filters">
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions" />
        </label>

        <label className="select-box">
          <Filter size={17} aria-hidden="true" />
          <select value={workspaceFilter} onChange={(event) => setWorkspaceFilter(event.target.value)}>
            <option value="all">All workspaces</option>
            {workspaces.map((ws) => (
              <option key={ws} value={ws}>
                {ws.length > 25 ? ws.slice(0, 25) + '…' : ws}
              </option>
            ))}
          </select>
        </label>

        <label className="date-box">
          <Calendar size={17} aria-hidden="true" />
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} title="From date" />
        </label>

        <label className="date-box">
          <Calendar size={17} aria-hidden="true" />
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} title="To date" />
        </label>

        <div className="meta-strip">
          <span>{filteredSessions.length} sessions</span>
          <span className="meta-aic">
            <Coins size={13} aria-hidden="true" />
            {formatAic(filteredSessions.reduce((sum, s) => sum + (s.cost.aiCredits ?? 0), 0))} AIC
            <span className="meta-kc">({totalKc.toFixed(0)} Kč)</span>
          </span>
          <span>{lastRefreshAt ? `Upd. ${formatShortDateTime(lastRefreshAt)}` : 'Waiting for first refresh'}</span>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {allNotesOpen && <AllNotesModal sessions={sessions} onNavigate={navigateToTurn} onClose={() => setAllNotesOpen(false)} />}

      {currentView === 'stats' ? (
        <StatsView sessions={filteredSessions} />
      ) : (
      <section className="content-grid">
        <div className="session-table" role="region" aria-label="Session list">
          {status === 'loading' ? <StateMessage title="Loading sessions" detail="Scanning local VS Code storage." /> : null}
          {status !== 'loading' && filteredSessions.length === 0 ? (
            <StateMessage title="No sessions found" detail="Check the storage root or continue a Copilot Chat turn to create local artifacts." />
          ) : null}

          {filteredSessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`session-row ${selectedSession?.id === session.id ? 'selected' : ''} ${session.cost.aiCredits !== undefined && session.cost.aiCredits <= 1 && !session.cost.usdCost ? 'dim' : ''}`}
              onClick={() => setSelectedId(session.id)}
            >
              <span className="summary-cell">
                <strong>{truncate(session.firstUserMessage ?? 'Untitled session', 60)}</strong>
                <small>
                  {session.workspaceName ?? session.workspaceStorageId}
                  {session.product ? <span className="product-tag">{session.product}</span> : null}
                </small>
              </span>
              <span>{formatDateTime(session.updatedAt)}</span>
              <span className="stats-cell">
                <span className="turns-badge">{session.userTurnCount}</span>
                <span className="req-count">{session.cost.requestCount ?? '—'}</span>
              </span>
              <span className="aic-cell">
                {session.cost.aiCredits !== undefined
                  ? <><Coins size={13} aria-hidden="true" />{formatAic(session.cost.aiCredits)}</>
                  : session.cost.usdCost !== undefined
                  ? <span className="kc-price">{usdToKc(session.cost.usdCost)} Kč</span>
                  : '—'}
              </span>
              <span className="badge-cell">
                {session.hasDebugLog ? (
                  <button
                    type="button"
                    className="debug-badge-btn"
                    onClick={(e) => { e.stopPropagation(); void openDetail(session.id); }}
                    title="Open debug detail"
                  >
                    <Bug size={15} aria-hidden="true" />
                    Debug
                  </button>
                ) : 'Transcript'}
              </span>
            </button>
          ))}
        </div>

        <aside className="detail-panel" aria-label="Selected session metadata">
          {selectedSession ? (
            <>
              <div className="detail-heading">
                <h2>{selectedSession.firstUserMessage ?? selectedSession.id}</h2>
                <span>{selectedSession.product ? `${selectedSession.product} · ` : ''}{selectedSession.producer}</span>
              </div>

              <dl>
                <dt>Updated</dt>
                <dd>{formatDateTime(selectedSession.updatedAt)}</dd>
                <dt>Started</dt>
                <dd>{selectedSession.startTime ? formatDateTime(selectedSession.startTime) : 'Unknown'}</dd>
                <dt>Messages</dt>
                <dd>{selectedSession.messageCount}</dd>
              </dl>

              <section className="cost-panel" aria-label="AI credit usage">
                <div className="cost-heading">
                  <Coins size={17} aria-hidden="true" />
                  <h3>AI Credits</h3>
                </div>
                <div className="cost-total">
                  {selectedCost.aiCredits !== undefined
                    ? <>{formatAic(selectedCost.aiCredits)} AIC <span className="kc-price">({aicToKc(selectedCost.aiCredits)} Kč)</span></>
                    : selectedCost.usdCost !== undefined
                    ? <><span className="kc-price">{usdToKc(selectedCost.usdCost)} Kč</span> <span className="cost-usd">(${selectedCost.usdCost.toFixed(4)})</span></>
                    : 'Not reported'}
                </div>
                <div className="cost-meta">
                  {(selectedCost.inputTokens || selectedCost.outputTokens || selectedCost.cachedTokens) ? (
                    <table className="token-table">
                      <tbody>
                        {selectedCost.inputTokens ? <tr><td>Input</td><td>{formatNumber(selectedCost.inputTokens)}</td></tr> : null}
                        {selectedCost.outputTokens ? <tr><td>Output</td><td>{formatNumber(selectedCost.outputTokens)}</td></tr> : null}
                        {selectedCost.cachedTokens ? <tr><td>Cached</td><td>{formatNumber(selectedCost.cachedTokens)}</td></tr> : null}
                      </tbody>
                    </table>
                  ) : null}
                  {selectedCost.models.length ? <span className="cost-models">{selectedCost.models.join(', ')}</span> : null}
                </div>
              </section>

              <div className="path-stack">
                {selectedSession.sourcePaths.transcript ? <PathLine label="Transcript" value={selectedSession.sourcePaths.transcript} /> : null}
                {selectedSession.sourcePaths.debugLog ? <PathLine label="Debug log" value={selectedSession.sourcePaths.debugLog} /> : null}
              </div>
            </>
          ) : (
            <StateMessage title="Select a session" detail="Click any session row to view turns and AI credit breakdown." />
          )}
        </aside>
      </section>
      )}
    </main>
  );
}

const STATS_MIN_AIC = 0.1;

function StatsView({ sessions }: { sessions: NormalizedSession[] }) {
  const qualifying = sessions.filter((s) =>
    (s.cost.aiCredits !== undefined && s.cost.aiCredits > STATS_MIN_AIC) ||
    s.cost.usdCost !== undefined ||
    (s.cost.inputTokens !== undefined && s.cost.inputTokens > 0) ||
    (s.cost.outputTokens !== undefined && s.cost.outputTokens > 0)
  );
  const count = qualifying.length;

  const totalInput = qualifying.reduce((sum, s) => sum + (s.cost.inputTokens ?? 0), 0);
  const totalCached = qualifying.reduce((sum, s) => sum + (s.cost.cachedTokens ?? 0), 0);
  const totalOutput = qualifying.reduce((sum, s) => sum + (s.cost.outputTokens ?? 0), 0);
  const totalAic = qualifying.reduce((sum, s) => sum + (s.cost.aiCredits ?? 0), 0);
  const totalKcFromAic = qualifying.reduce((sum, s) => sum + (s.cost.aiCredits !== undefined ? s.cost.aiCredits / 4.8 : 0), 0);
  const totalKcFromUsd = qualifying.reduce((sum, s) => sum + (s.cost.usdCost !== undefined ? s.cost.usdCost * 23 : 0), 0);
  const totalKc = totalKcFromAic + totalKcFromUsd;

  const withInput = qualifying.filter((s) => s.cost.inputTokens !== undefined).length;
  const withCached = qualifying.filter((s) => s.cost.cachedTokens !== undefined).length;
  const withOutput = qualifying.filter((s) => s.cost.outputTokens !== undefined).length;
  const withAic = qualifying.filter((s) => s.cost.aiCredits !== undefined).length;
  const withKc = qualifying.filter((s) => s.cost.aiCredits !== undefined || s.cost.usdCost !== undefined).length;

  const avgInput = withInput > 0 ? totalInput / withInput : 0;
  const avgCached = withCached > 0 ? totalCached / withCached : 0;
  const avgOutput = withOutput > 0 ? totalOutput / withOutput : 0;
  const avgAic = withAic > 0 ? totalAic / withAic : 0;
  const avgKc = withKc > 0 ? totalKc / withKc : 0;

  return (
    <div className="stats-view">
      <div className="stats-header">
        <BarChart2 size={18} aria-hidden="true" />
        <span>Statistiky tokenů a nákladů</span>
        <span className="stats-session-count">{count} sessions (z {sessions.length})</span>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-label">Input tokeny</div>
          <div className="stat-card-total">{formatNumber(totalInput)}</div>
          <div className="stat-card-sub">celkem</div>
          <div className="stat-card-avg">{formatNumber(Math.round(avgInput))}</div>
          <div className="stat-card-sub">průměr / session ({withInput})</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Cache tokeny</div>
          <div className="stat-card-total">{formatNumber(totalCached)}</div>
          <div className="stat-card-sub">celkem</div>
          <div className="stat-card-avg">{formatNumber(Math.round(avgCached))}</div>
          <div className="stat-card-sub">průměr / session ({withCached})</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Output tokeny</div>
          <div className="stat-card-total">{formatNumber(totalOutput)}</div>
          <div className="stat-card-sub">celkem</div>
          <div className="stat-card-avg">{formatNumber(Math.round(avgOutput))}</div>
          <div className="stat-card-sub">průměr / session ({withOutput})</div>
        </div>
        <div className="stat-card stat-card--aic">
          <div className="stat-card-label">Náklady</div>
          <div className="stat-card-total">{totalKc.toFixed(1)} <span className="stat-aic-unit">Kč</span></div>
          <div className="stat-card-sub">{formatAic(totalAic)} AIC + ${(totalKcFromUsd / 23).toFixed(4)} USD</div>
          <div className="stat-card-avg">{avgKc.toFixed(2)} <span className="stat-aic-unit">Kč</span></div>
          <div className="stat-card-sub">průměr / session ({withKc})</div>
        </div>
      </div>
    </div>
  );
}

interface TurnNote { title: string; text: string; }

function readTurnNote(key: string): TurnNote {
  const raw = localStorage.getItem(key);
  if (!raw) return { title: '', text: '' };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && 'text' in parsed) {
      return parsed as TurnNote;
    }
  } catch { /* ignore */ }
  return { title: '', text: raw };
}

function TurnCard({ turn, sessionId }: { turn: TurnInfo; sessionId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const hasActivity = turn.toolCalls.length > 0 || turn.subTurnCount > 0;
  const noteKey = `turn-note-${sessionId ?? 'unknown'}-${turn.index}`;
  const [note, setNote] = useState<TurnNote>(() => readTurnNote(noteKey));
  const [noteOpen, setNoteOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');

  function openNote() {
    setDraftTitle(note.title);
    setDraftText(note.text);
    setNoteOpen(true);
  }

  function saveNote() {
    const updated: TurnNote = { title: draftTitle.trim(), text: draftText.trim() };
    setNote(updated);
    if (updated.title || updated.text) {
      localStorage.setItem(noteKey, JSON.stringify(updated));
    } else {
      localStorage.removeItem(noteKey);
    }
    setNoteOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      setNoteOpen(false);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      saveNote();
    }
  }

  return (
    <div className="turn-card" id={`turn-${turn.index}`}>
      <div className="turn-header">
        <span className="turn-index">#{turn.index + 1}</span>
        <span className="turn-message">{turn.userMessage ?? '(no message)'}</span>
        <span className="turn-time">{formatDateTime(turn.timestamp)}</span>
      </div>
      <div className="turn-body">
        <div className="turn-aic">
          <Coins size={14} aria-hidden="true" />
          {turn.aiCredits !== undefined
            ? <strong>{formatAic(turn.aiCredits)} AIC <span className="kc-price">({aicToKc(turn.aiCredits)} Kč)</span></strong>
            : turn.usdCost !== undefined
            ? <strong><span className="kc-price">{usdToKc(turn.usdCost)} Kč</span></strong>
            : <span className="no-aic">—</span>}
        </div>
        <div className="turn-chips">
          {turn.inputTokens > 0 ? <span>{formatNumber(turn.inputTokens)} in</span> : null}
          {turn.outputTokens > 0 ? <span>{formatNumber(turn.outputTokens)} out</span> : null}
          {turn.cachedTokens > 0 ? <span>{formatNumber(turn.cachedTokens)} cached</span> : null}
          {turn.llmRequestCount > 0 ? <span>{turn.llmRequestCount} req</span> : null}
          {turn.models.map((m) => <span key={m} className="model-chip">{m}</span>)}
          {turn.hasBrowserContext && <span className="browser-chip" title="Obsahuje Attached Element Context">🌐 browser</span>}
          {hasActivity && (
            <button type="button" className="activity-toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '▲' : '▼'} aktivita
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        className={`turn-note-btn${(note.title || note.text) ? ' turn-note-btn--has-note' : ''}`}
        onClick={openNote}
        title={(note.title || note.text) ? `${note.title ? note.title + ': ' : ''}${note.text}` : 'Přidat poznámku'}
        aria-label="Poznámka"
      >
        <Pencil size={13} aria-hidden="true" />
      </button>

      {noteOpen && (
        <div className="turn-note-overlay" onClick={(e) => { if (e.target === e.currentTarget) setNoteOpen(false); }}>
          <div className="turn-note-popup">
            <p className="turn-note-popup-title">Poznámka k turnu #{turn.index + 1}</p>
            <input
              type="text"
              className="turn-note-title-input"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Nadpis (volitelné)"
            />
            <textarea
              autoFocus
              className="turn-note-textarea"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Napiš poznámku…"
              rows={4}
            />
            <div className="turn-note-actions">
              <button type="button" className="turn-note-save" onClick={saveNote}>Uložit</button>
              <button type="button" className="turn-note-cancel" onClick={() => setNoteOpen(false)}>Zrušit</button>
            </div>
          </div>
        </div>
      )}

      {expanded && hasActivity && (
        <div className="turn-activity">
          {turn.subTurnCount > 0 && (
            <div className="activity-row">
              <span className="activity-label">agent loop</span>
              <span className="activity-value">{turn.subTurnCount}× LLM round</span>
            </div>
          )}
          {turn.toolCalls.map((tc, i) => (
            <div key={i} className="activity-row">
              <span className="activity-label">tool</span>
              <span className="activity-value">
                <span className="activity-tool-name">{tc.name}</span>
                {tc.detail ? <span className="activity-detail">{tc.detail}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AllNotesModal({ sessions, onNavigate, onClose }: { sessions: NormalizedSession[]; onNavigate: (sessionId: string, turnIndex: number) => void; onClose: () => void }) {
  const allNotes = useMemo(() => {
    const result: { sessionId: string; workspaceName: string; updatedAt: string; turnIndex: number; note: TurnNote }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('turn-note-')) continue;
      const rest = key.slice('turn-note-'.length);
      const lastDash = rest.lastIndexOf('-');
      if (lastDash === -1) continue;
      const sessionId = rest.slice(0, lastDash);
      const turnIndex = parseInt(rest.slice(lastDash + 1), 10);
      if (isNaN(turnIndex)) continue;
      const note = readTurnNote(key);
      if (!note.title && !note.text) continue;
      const session = sessions.find((s) => s.id === sessionId);
      const workspaceName = session?.workspaceName ?? session?.workspaceStorageId ?? sessionId;
      const updatedAt = session?.updatedAt ?? '';
      result.push({ sessionId, workspaceName, updatedAt, turnIndex, note });
    }
    result.sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.turnIndex - b.turnIndex);
    return result;
  }, [sessions]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof allNotes>();
    for (const item of allNotes) {
      const arr = map.get(item.sessionId) ?? [];
      arr.push(item);
      map.set(item.sessionId, arr);
    }
    return [...map.entries()];
  }, [allNotes]);

  return (
    <div className="turn-note-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="notes-list-modal notes-list-modal--wide">
        <div className="notes-list-header">
          <Pencil size={16} aria-hidden="true" />
          <span>Všechny poznámky</span>
          <span className="notes-list-count">{allNotes.length}</span>
          <button type="button" className="notes-list-close" onClick={onClose} aria-label="Zavřít">✕</button>
        </div>
        {grouped.length === 0 ? (
          <p className="notes-list-empty">Zatím žádné poznámky.</p>
        ) : (
          <div className="notes-list-items">
            {grouped.map(([sessionId, items]) => (
              <div key={sessionId} className="notes-group">
                <div className="notes-group-divider" />
                {items.map(({ turnIndex, note, workspaceName, updatedAt }) => (
                  <div key={turnIndex} className="notes-list-item notes-list-item--link" onClick={() => onNavigate(sessionId, turnIndex)}>
                    <div className="notes-list-item-meta">
                      {updatedAt && <span className="notes-group-date">{formatDateTime(updatedAt)}</span>}
                      <span className="notes-group-workspace">{workspaceName}</span>
                    </div>
                    {note.title && <div className="notes-list-title">{note.title}</div>}
                    {note.text && <div className="notes-list-text">{note.text}</div>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotesListModal({ sessionId, turns, onClose }: { sessionId: string; turns: TurnInfo[]; onClose: () => void }) {
  const notes = turns
    .map((turn) => {
      const key = `turn-note-${sessionId}-${turn.index}`;
      const note = readTurnNote(key);
      return { turn, note, key };
    })
    .filter(({ note }) => note.title || note.text);

  return (
    <div className="turn-note-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="notes-list-modal">
        <div className="notes-list-header">
          <Pencil size={16} aria-hidden="true" />
          <span>Poznámky</span>
          <button type="button" className="notes-list-close" onClick={onClose} aria-label="Zavřít">✕</button>
        </div>
        {notes.length === 0 ? (
          <p className="notes-list-empty">Žádné poznámky k této session.</p>
        ) : (
          <div className="notes-list-items">
            {notes.map(({ turn, note, key }) => (
              <div key={key} className="notes-list-item">
                <div className="notes-list-item-meta">
                  <span className="notes-list-turn">#{turn.index + 1}</span>
                  <span className="notes-list-turn-msg">{turn.userMessage ?? '(no message)'}</span>
                </div>
                {note.title && <div className="notes-list-title">{note.title}</div>}
                {note.text && <div className="notes-list-text">{note.text}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StateMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="state-message">
      <Clock3 size={22} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

const TOOLS_PREVIEW_COUNT = 4;

function SessionOverviewPanel({ overview }: { overview: SessionOverview }) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const mcpTools = overview.tools.filter((t) => t.isMcp);
  const builtinTools = overview.tools.filter((t) => !t.isMcp);
  const mcpServers = [...new Set(mcpTools.map((t) => t.mcpServer ?? 'unknown'))];
  const getServerBytes = (server: string) =>
    server === '__builtin__'
      ? builtinTools.reduce((s, t) => s + t.sizeBytes, 0)
      : mcpTools.filter((t) => (t.mcpServer ?? 'unknown') === server).reduce((s, t) => s + t.sizeBytes, 0);
  const allServers = [...mcpServers, ...(builtinTools.length > 0 ? ['__builtin__'] : [])].sort(
    (a, b) => getServerBytes(b) - getServerBytes(a)
  );
  const visibleServers = toolsExpanded ? allServers : allServers.slice(0, TOOLS_PREVIEW_COUNT);
  const hiddenCount = allServers.length - TOOLS_PREVIEW_COUNT;

  return (
    <div className="session-overview">
      <div className="overview-grid">
        {overview.skills.length > 0 && (
          <div className="overview-section">
            <h3 className="overview-section-title">Skills ({overview.skills.length})</h3>
            <ul className="overview-list">
              {overview.skills.map((skill) => (
                <li key={skill.name} title={skill.description}>
                  <span className="overview-name">{skill.name}</span>
                  <span className="overview-size">{(skill.sizeBytes / 1024).toFixed(1)} kB</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {overview.agents.length > 0 && (
          <div className="overview-section">
            <h3 className="overview-section-title">Agents ({overview.agents.length})</h3>
            <ul className="overview-list">
              {overview.agents.map((agent) => (
                <li key={agent.name} title={agent.description}>
                  <span className="overview-name">{agent.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {overview.tools.length > 0 && (
          <div className="overview-section overview-section--tools">
            <h3 className="overview-section-title">Tools ({overview.tools.length})</h3>
            <div className="overview-tools-group">
              {visibleServers.map((server) => {
                if (server === '__builtin__') {
                  const builtinKb = (builtinTools.reduce((s, t) => s + t.sizeBytes, 0) / 1024).toFixed(1);
                  return (
                    <div key="__builtin__" className="overview-mcp-server overview-mcp-server--builtin">
                      <span className="mcp-server-name">Built-in</span>
                      <span className="mcp-tool-count">{builtinTools.length} tools · {builtinKb} kB</span>
                    </div>
                  );
                }
                const serverTools = mcpTools.filter((t) => (t.mcpServer ?? 'unknown') === server);
                const count = serverTools.length;
                const serverKb = (serverTools.reduce((s, t) => s + t.sizeBytes, 0) / 1024).toFixed(1);
                return (
                  <div key={server} className="overview-mcp-server">
                    <span className="mcp-server-name">{server}</span>
                    <span className="mcp-tool-count">{count} {count === 1 ? 'tool' : 'tools'} · {serverKb} kB</span>
                  </div>
                );
              })}
              {!toolsExpanded && hiddenCount > 0 && (
                <button className="overview-tools-expand" onClick={() => setToolsExpanded(true)}>
                  + {hiddenCount} more servers
                </button>
              )}
              {toolsExpanded && allServers.length > TOOLS_PREVIEW_COUNT && (
                <button className="overview-tools-expand" onClick={() => setToolsExpanded(false)}>
                  Show less
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {overview.contextSizes && <ContextWindowBar sizes={overview.contextSizes} />}
    </div>
  );
}

function ContextWindowBar({ sizes }: { sizes: ContextSizes }) {
  const toKb = (b: number) => b / 1024;
  const fmtKb = (kb: number) => kb >= 1 ? `${kb.toFixed(1)} kB` : `${(kb * 1024).toFixed(0)} B`;

  const skillsKb = toKb(sizes.systemPromptSkillsBytes);
  const agentsKb = toKb(sizes.systemPromptAgentsBytes);
  const otherKb = Math.max(0, toKb(sizes.systemPromptTotalBytes) - skillsKb - agentsKb);
  const toolsKb = toKb(sizes.toolsBytes);
  const userKb = toKb(sizes.userPromptBytes);
  const totalKb = toKb(sizes.systemPromptTotalBytes) + toolsKb + userKb;

  const segments = [
    { key: 'other', kb: otherKb, label: 'Instructions', className: 'ctx-seg--other' },
    { key: 'skills', kb: skillsKb, label: 'Skills', className: 'ctx-seg--skills' },
    { key: 'agents', kb: agentsKb, label: 'Agents', className: 'ctx-seg--agents' },
    { key: 'tools', kb: toolsKb, label: 'Tools', className: 'ctx-seg--tools' },
    { key: 'user', kb: userKb, label: 'User prompt', className: 'ctx-seg--user' },
  ].filter((s) => s.kb > 0);

  const pct = (kb: number) => totalKb > 0 ? Math.min(100, (kb / totalKb) * 100).toFixed(3) : '0';

  return (
    <div className="ctx-window">
      <div className="ctx-window-header">
        <span className="ctx-window-label">Context window</span>
        {sizes.model && <span className="ctx-window-model">{sizes.model}</span>}
        <span className="ctx-window-usage">{fmtKb(totalKb)} total</span>
      </div>
      <div className="ctx-bar" role="img" aria-label={`Context window: ${fmtKb(totalKb)}`}>
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={`ctx-seg ${seg.className}`}
            style={{ width: `${pct(seg.kb)}%` }}
            title={`${seg.label}: ${fmtKb(seg.kb)}`}
          />
        ))}
      </div>
      <div className="ctx-legend">
        {segments.map((seg) => (
          <span key={seg.key} className={`ctx-legend-item ctx-legend-item--${seg.key}`}>
            <span className="ctx-legend-dot" />
            {seg.label} <span className="ctx-legend-val">{fmtKb(seg.kb)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PathLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="path-line">
      <span>{label}</span>
      <a href={`vscode://file/${encodeURI(value)}`} title={value} className="path-link">
        <code>{value}</code>
      </a>
    </div>
  );
}

function truncate(text: string, max: number) {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatShortDateTime(value: string) {
  const d = new Date(value);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}. ${hours}:${minutes}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
}

function formatAic(value: number) {
  return value.toFixed(2);
}

function aicToKc(value: number) {
  return (value / 4.8).toFixed(1);
}

function usdToKc(usd: number) {
  return (usd * 23).toFixed(1);
}
