# VS Code Sessions Viewer

Lokální viewer pro čtení a procházení VS Code Copilot Chat sessions z lokálních transcript/debug JSONL souborů.

## Ukázka rozhraní

![Seznam sessions](docs/CleanShot%202026-06-09%20at%2007.34.52@2x.png)

![Detail session](docs/CleanShot%202026-06-09%20at%2007.35.05@2x.png)

## Disclaimer

- Toto je draft aplikace publikovaný jako výchozí bod pro další úpravy.
- Projekt není oficiální nástroj GitHubu, Microsoftu ani VS Code.
- Aplikace je určená hlavně pro vývojáře, kteří si ji chtějí přizpůsobit vlastním potřebám, lokálním cestám a způsobu práce.
- Funguje na macOS, Windows i Linuxu. Konkrétní úpravy mohou být potřeba podle instalace VS Code a struktury lokálních dat.
- Vedle běžného VS Code skenuje i další varianty postavené na VS Code (VS Code Insiders, VSCodium, Cursor, Windsurf, Antigravity, Devin, Trae, Positron…), pokud v nich máš rozšíření GitHub Copilot Chat.
- Formát Copilot Chat logů není stabilní veřejné API, proto se může mezi verzemi VS Code měnit.

> [!WARNING]
> Tato aplikace byla vytvořena převážně pomocí generativní umělé inteligence. Kód může obsahovat chyby, bezpečnostní nedostatky nebo neočekávané chování. Používáte ji na vlastní riziko. Před nasazením nebo úpravou pro vlastní potřeby si kód důkladně prostudujte a ověřte.

## Co projekt dělá

- Skenuje lokální VS Code `workspaceStorage` a hledá Copilot Chat transcripts a debug logy.
- Čte hlavně soubory `GitHub.copilot-chat/transcripts/*.jsonl` a `GitHub.copilot-chat/debug-logs/*/*.jsonl`.
- Normalizuje nalezená data do jednoduššího modelu pro UI.
- Zobrazuje seznam sessions, základní metadata, modely, agenty, nástroje, odhad nákladů a detail turnů, pokud je dostupný debug log.
- Pracuje pouze s lokálními soubory. Nevolá žádná interní Copilot, Chronicle ani GitHub API.
- Parsování JSONL je tolerantní: nevalidní nebo neznámé řádky se přeskočí, aby jeden poškozený záznam nerozbil celý scan.

## Architektura

- Frontend: React + Vite v `src/`.
- Backend: Node.js + Express v `server/`.
- Sdílený backend kontrakt je v `server/sources/SessionSource.ts`.
- Hlavní implementace zdroje dat je `server/sources/VsCodeTranscriptSource.ts`.
- Backend vystavuje REST API pod `/api/*`.
- Frontend komunikuje s backendem přes relativní `/api/...` requesty.
- V dev režimu se frontend a backend spouští současně přes `npm run dev`.

Zjednodušený tok dat:

```text
VS Code workspaceStorage
	-> transcript/debug JSONL soubory
	-> VsCodeTranscriptSource
	-> Express REST API /api/*
	-> React UI
```

## Spuštění

Požadavky:

- Node.js 20 nebo novější.
- Lokální instalace VS Code s existujícími Copilot Chat logy.

```bash
npm install
npm run dev
```

Pomocné spouštěcí skripty:

- macOS / Linux: `./run.sh`
- Windows (PowerShell): `./run.ps1`
- Windows (cmd.exe): `run.cmd`

- Web běží na `http://127.0.0.1:5173`.
- API běží na `http://127.0.0.1:4317`.

## Užitečné příkazy

```bash
npm run typecheck
npm run build
npm run start
```

- `npm run typecheck` ověří TypeScript pro frontend i backend.
- `npm run build` sestaví frontend i backend.
- `npm run start` spustí sestavený backend z `dist/server/index.js`.

## Konfigurace

- `PORT` mění port backendu.
- `VSCODE_WORKSPACE_STORAGE_ROOT` přepíše automatickou detekci kořenů `workspaceStorage`. Více cest odděl systémovým oddělovačem (`;` na Windows, `:` jinde).
- `VSCODE_COPILOT_SESSION_ROOT` nastaví přímý kořen pro testovací data.
- `SESSION_POLL_INTERVAL_MS` mění interval záložního refreshování.

Pokud `VSCODE_WORKSPACE_STORAGE_ROOT` není nastavený, aplikace automaticky prohledá
nadřazený app-data adresář podle platformy a najde všechny varianty postavené na
VS Code, které obsahují `User/workspaceStorage`:

- macOS: `~/Library/Application Support/<produkt>/User/workspaceStorage`
- Windows: `%APPDATA%\<produkt>\User\workspaceStorage` a `%LOCALAPPDATA%\<produkt>\User\workspaceStorage`
- Linux: `~/.config/<produkt>/User/workspaceStorage`

`<produkt>` je např. `Code`, `Code - Insiders`, `VSCodium`, `Cursor`, `Windsurf`,
`Antigravity`, `Devin`, `Trae` nebo `Positron`. Sloupec v UI ukazuje, ze které
varianty session pochází.

Příklad spuštění s vlastní cestou:

```bash
# macOS / Linux
VSCODE_WORKSPACE_STORAGE_ROOT="/path/to/workspaceStorage" npm run dev
```

```powershell
# Windows PowerShell (jeden nebo více kořenů oddělených ';')
$env:VSCODE_WORKSPACE_STORAGE_ROOT = "$env:APPDATA\Code\User\workspaceStorage;$env:APPDATA\Windsurf\User\workspaceStorage"
npm run dev
```

## Vývoj a úpravy

- Nové zdroje dat přidávej jako další implementace `SessionSource`.
- Datové kontrakty měň současně na backendu i ve frontendu.
- Počítej s tím, že JSONL záznamy mají proměnlivý tvar.
- Udržuj parsování tolerantní vůči chybějícím nebo neznámým polím.
- Před dokončením změn spusť `npm run typecheck`.

## Bezpečnost a soukromí

- Aplikace čte lokální soubory z počítače, na kterém běží.
- Copilot Chat logy mohou obsahovat názvy projektů, fragmenty kódu, prompty nebo jiné citlivé informace.
- Před sdílením screenshotů, exportů nebo vzorků dat zkontroluj, že neobsahují soukromý obsah.
