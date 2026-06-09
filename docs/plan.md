## Plan: VS Code Sessions Viewer

Vytvorit minimalni lokalni aplikaci, ktera se spusti v prohlizeci a zobrazi seznam Copilot/VS Code sessions. Protoze skiller.md popisuje interni Chronicle/Copilot session store a ne verejne API pro bezny frontend, MVP bude mit Node backend se zdrojovou abstrakci. Prvni zdroj bude cist lokalni VS Code Copilot Chat transcripts/debug logs z disku a bude refreshovat seznam zive pres file watching/polling. UI zustane jednoduche, tmave a pripravené pro pozdejsi debugging detail.

**Steps**
1. Create /Users/mholec/Downloads/____optimiser/docs/implementation-plan.md containing this plan before code changes, so the project keeps an implementation handoff document.
2. Scaffold project from empty workspace as Vite + React + TypeScript frontend plus Node/Express TypeScript backend. Keep existing skiller.md and src/ untouched except using src/ as frontend source root if Vite template creates it.
3. Add root package scripts for one-command run: dev starts backend and frontend together; build compiles frontend and backend; typecheck verifies both TS projects. Use npm unless user specifies another package manager.
4. Create backend configuration layer. Default macOS storage root: ~/Library/Application Support/Code/User/workspaceStorage. Allow override via VSCODE_WORKSPACE_STORAGE_ROOT and optional VSCODE_COPILOT_SESSION_ROOT for direct testing.
5. Implement SessionSource abstraction with a local VsCodeTranscriptSource. It scans workspaceStorage/**/GitHub.copilot-chat/transcripts/*.jsonl and debug-logs/*/main.jsonl, parses JSONL safely line-by-line, and normalizes each session into id, workspaceStorageId, source paths, startTime, updatedAt, producer, copilotVersion, vscodeVersion, firstUserMessage, messageCount, agent/tool indicators, and hasDebugLog.
6. Add live refresh in backend. Use chokidar or Node fs.watch with debounce plus periodic fallback polling. Maintain an in-memory cache sorted by updatedAt descending.
7. Expose API endpoints: GET /api/sessions for the list; GET /api/sessions/:id for raw/expanded metadata only if cheap to add during MVP. Keep query support minimal now, likely ?agent= and ?q= if normalization already has searchable fields.
8. Build frontend session list. Show loading/error/empty states, auto-refresh indicator, last refresh time, total count, agent/source filters if available, and a dense list/table with summary, id, updated time, source, message count, and debug-log availability.
9. Apply dark HolecAI styling from user memory: gradient/dark background, translucent panels, white text, copper accents, no white cards, reset component margins. Keep UI compact because this is a tool, not a landing page.
10. Add README with run command, environment variables, limitations, and how the MVP maps to skiller.md/Chronicle. Explicitly document that the internal session_store_sql tool is not directly callable by a normal app, so this MVP reads local VS Code session artifacts and keeps an adapter boundary for a future official/cloud source.
11. Keep future debug UI ready by linking list rows to a placeholder detail route or selected-session panel, but do not build transcript/debug inspection yet.

**Relevant files**
- /Users/mholec/Downloads/____optimiser/skiller.md — source context: Chronicle workflow, session_store_sql actions, relevant schema concepts.
- /Users/mholec/Downloads/____optimiser/package.json — create scripts and dependencies.
- /Users/mholec/Downloads/____optimiser/vite.config.ts — create frontend dev server config and proxy to backend.
- /Users/mholec/Downloads/____optimiser/tsconfig.json plus backend/frontend tsconfig files if needed — create TypeScript config.
- /Users/mholec/Downloads/____optimiser/server/index.ts — create Express server entry point.
- /Users/mholec/Downloads/____optimiser/server/sources/SessionSource.ts — create normalized session interfaces and adapter contract.
- /Users/mholec/Downloads/____optimiser/server/sources/VsCodeTranscriptSource.ts — create local VS Code transcript/debug-log scanner and watcher.
- /Users/mholec/Downloads/____optimiser/src/main.tsx — create React entry point.
- /Users/mholec/Downloads/____optimiser/src/App.tsx — create sessions list UI.
- /Users/mholec/Downloads/____optimiser/src/styles.css — create dark tool styling.
- /Users/mholec/Downloads/____optimiser/README.md — create setup and usage notes.

**Verification**
1. Run npm install after scaffolding/dependency changes.
2. Run npm run typecheck to verify frontend/backend TypeScript.
3. Run npm run build to verify production build.
4. Run npm run dev and open the Vite URL. Confirm the sessions list appears.
5. Confirm API directly: GET http://localhost:<backend-port>/api/sessions returns JSON with at least the current transcript session when VS Code Copilot Chat logs exist.
6. Create or continue a Copilot Chat turn, then verify the list refreshes without restarting the app.
7. Test empty/unavailable storage by setting VSCODE_WORKSPACE_STORAGE_ROOT to a temporary empty directory and confirm the UI shows a helpful empty state instead of crashing.

**Decisions**
- Build as a local web app with Node backend, not a pure browser app, because browser code cannot read VS Code's local session files.
- Use local transcript/debug-log files for MVP live loading. Treat Chronicle/session_store_sql as conceptual schema guidance, not as a directly callable runtime dependency.
- Include all local VS Code workspaceStorage folders by default, not only the current workspace, so the list is useful immediately.
- Exclude full debugging/transcript viewer for now; only list sessions and expose enough metadata for the next phase.
- Exclude cloud DuckDB direct access for now unless an official API or readable local database path is later identified.

**Further Considerations**
1. If the implementation agent discovers a stable local SQLite index for Chronicle, add it as a second SessionSource and prefer it over transcript scanning for richer historical data.
2. If the app should run inside VS Code rather than browser, switch to a VS Code extension webview plan; this is heavier but can feel more native later.
3. If cross-device cloud sessions are required in MVP, the plan must change because the current evidence only exposes cloud sessions to the assistant tool, not to arbitrary local app code.