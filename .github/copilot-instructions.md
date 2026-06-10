## Komunikace AI agenta a reasoning

- Piš česky.
- Buď maximálně stručný.
- Používej body místo dlouhých odstavců.
- V průběžných výstupech uváděj jen stav, výsledek nebo potřebnou akci uživatele.
- Nevysvětluj samozřejmý kód.

## Účel aplikace

- Aplikace je lokální viewer VS Code Copilot Chat sessions.
- Cíl je čtení lokálních transcript/debug JSONL souborů.

## Architektura

- Frontend: React + Vite v `src/`.
- Backend: Node + Express v `server/`.
- Sdílené datové kontrakty drž v `server/sources/SessionSource.ts` a zrcadli je ve frontendu jen podle potřeby.
- Hlavní datový zdroj je `VsCodeTranscriptSource`.
- Backend vystavuje REST API pod `/api/*`.
- Frontend komunikuje s backendem přes relativní `/api/...` requesty.
- Dev režim spouští frontend i backend současně přes `npm run dev`.

## Zdroj dat

- Výchozí root dat se detekuje automaticky pro všechny varianty postavené na VS Code (Code, Insiders, VSCodium, Cursor, Windsurf, Antigravity, Devin…) napříč macOS, Windows i Linuxem.
- Skenování je multi-root; cesty normalizuj na POSIX oddělovače (`toPosix`), protože fast-glob i parsing segmentů to vyžadují na Windows.
- Konfigurace je v `server/config.ts`.
- Podporuj proměnné `PORT`, `VSCODE_WORKSPACE_STORAGE_ROOT`, `VSCODE_COPILOT_SESSION_ROOT`, `SESSION_POLL_INTERVAL_MS`.
- Skenuj transcript soubory `GitHub.copilot-chat/transcripts/*.jsonl`.
- Skenuj debug logy `GitHub.copilot-chat/debug-logs/*/*.jsonl`.
- Preferuj `main.jsonl` pro detail turnů.
- Počítej s tím, že JSONL záznamy mají proměnlivý tvar.

## Backend principy

- Zachovej source abstraction přes `SessionSource`.
- Nové zdroje dat přidávej jako další implementace `SessionSource`.
- Parsování musí být tolerantní: nevalidní řádky přeskoč, neukončuj celý scan.
- Normalizuj data do jednoduchých struktur pro UI.
- Nečti celý svět synchronně v request handleru.
- Refresh drž v datovém zdroji; endpointy mají vracet aktuální snapshot.
- File watching je doplněk, polling je fallback.
- Chyby ukládej do snapshotu, aby je UI mohlo zobrazit.

## Frontend principy

- UI je pracovní nástroj, ne landing page.
- Zachovej tmavý vizuální styl.
- Používej kompaktní layout pro skenování dat.
- Ikony ber z `lucide-react`.
- Filtry a výběr drž klientsky, pokud objem dat zůstává malý.
- Detail session otevírej přes existující `/api/sessions/:id/turns` a `/api/sessions/:id/overview`.
- Nevkládej marketingové texty ani vysvětlovací bloky do aplikace.

## Datový model

- Session je normalizovaný souhrn jedné Copilot konverzace.
- ID session ber z debug-log adresáře nebo názvu transcriptu.
- `workspaceStorageId` je odvozený z cesty ve `workspaceStorage`.
- `workspaceName` čti z `workspace.json`, pokud existuje.
- Náklady skládej z dostupných tokenů a `copilotUsageNanoAiu`.
- Agenty, nástroje a modely ukládej jako sety a na výstupu seřaď.

## Testování a ověření

- Před dokončením změn spusť `npm run typecheck`.
- Po větších změnách backendu spusť i `npm run build`.
- Nespouštěj dlouhé servery zbytečně, pokud stačí typecheck.
- Neměň formát dat bez úpravy obou stran kontraktu.

## Styl změn

- Dělej malé, cílené změny.
- Nepřidávej novou abstrakci bez jasného důvodu.
- Nepřepisuj UI plošně kvůli malé úpravě.
- Nepoužívej bílé/light kontejnery; projekt je tmavý.
- Udržuj TypeScript striktní a bez `any`, pokud existuje rozumná alternativa.
- Nevracej ani nemaž uživatelské změny mimo aktuální úkol.