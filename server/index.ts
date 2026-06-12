import cors from 'cors';
import express from 'express';
import { loadConfig } from './config.js';
import { AntigravitySource } from './sources/AntigravitySource.js';
import { ClaudeCodeSource } from './sources/ClaudeCodeSource.js';
import { DevinSource } from './sources/DevinSource.js';
import { MultiSource } from './sources/MultiSource.js';
import { VsCodeChatSessionsSource } from './sources/VsCodeChatSessionsSource.js';
import { VsCodeTranscriptSource } from './sources/VsCodeTranscriptSource.js';
import { WindsurfCascadeSource } from './sources/WindsurfCascadeSource.js';

const config = loadConfig();
const app = express();

const sources = [
  new VsCodeTranscriptSource({
    workspaceStorageRoots: config.workspaceStorageRoots,
    directCopilotSessionRoot: config.directCopilotSessionRoot,
    pollIntervalMs: config.pollIntervalMs
  }),
  new ClaudeCodeSource(config.pollIntervalMs),
  new VsCodeChatSessionsSource(config.workspaceStorageRoots, config.pollIntervalMs)
];

const windsurfSource = WindsurfCascadeSource.create(config.pollIntervalMs);
if (windsurfSource) sources.push(windsurfSource);

const antigravitySource = AntigravitySource.create(config.pollIntervalMs);
if (antigravitySource) sources.push(antigravitySource);

const devinSource = DevinSource.create(config.pollIntervalMs);
if (devinSource) sources.push(devinSource);

const source = new MultiSource(sources);

app.use(cors());
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, lastRefreshAt: source.listSessions().lastRefreshAt });
});

app.get('/api/sessions', (request, response) => {
  const snapshot = source.listSessions();
  const q = typeof request.query.q === 'string' ? request.query.q.toLowerCase() : undefined;
  const agent = typeof request.query.agent === 'string' ? request.query.agent.toLowerCase() : undefined;

  const sessions = snapshot.sessions.filter((session) => {
    const matchesQuery = q
      ? [session.id, session.workspaceStorageId, session.workspaceName, session.product, session.firstUserMessage, session.producer]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(q))
      : true;
    const matchesAgent = agent ? session.agents.some((value) => value.toLowerCase() === agent) : true;
    return matchesQuery && matchesAgent;
  });

  response.json({ ...snapshot, sessions, total: sessions.length });
});

app.get('/api/sessions/:id', (request, response) => {
  const session = source.getSession(request.params.id);
  if (!session) {
    response.status(404).json({ error: 'Session not found' });
    return;
  }

  response.json(session);
});

app.get('/api/sessions/:id/overview', async (request, response) => {
  const session = source.getSession(request.params.id);
  if (!session) {
    response.status(404).json({ error: 'Session not found' });
    return;
  }

  const overview = await source.getSessionOverview(request.params.id);
  if (!overview) {
    response.status(404).json({ error: 'No overview data available (debug log required)' });
    return;
  }

  response.json(overview);
});

app.get('/api/sessions/:id/turns', async (request, response) => {
  const session = source.getSession(request.params.id);
  if (!session) {
    response.status(404).json({ error: 'Session not found' });
    return;
  }

  const turns = await source.getSessionTurns(request.params.id);
  response.json({ turns, total: turns.length });
});

await source.start();

const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`Sessions API listening on http://127.0.0.1:${config.port}`);
  console.log('Sources:');
  console.log('  [Copilot] workspaceStorage roots:');
  const copilotRoots = config.directCopilotSessionRoot ? [config.directCopilotSessionRoot] : config.workspaceStorageRoots;
  for (const root of copilotRoots) console.log(`    - ${root}`);
  console.log('  [Claude Code] ~/.claude/projects/**/*.jsonl');
  console.log('  [VS Code Chat] workspaceStorage/**/chatSessions/*.jsonl');
  if (windsurfSource) console.log('  [Windsurf Cascade] globalStorage/state.vscdb');
  if (antigravitySource) console.log('  [Antigravity] ~/.gemini/antigravity/brain/');
  if (devinSource) console.log('  [Devin] devin/cli/sessions.db');
});

async function shutdown(): Promise<void> {
  await source.stop();
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
