import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ServerConfig {
  port: number;
  workspaceStorageRoots: string[];
  directCopilotSessionRoot?: string;
  pollIntervalMs: number;
}

// Known VS Code-family product directories (under the per-platform app-data dir).
// Auto-discovery handles anything not listed; this is just a fallback probe order.
const KNOWN_PRODUCT_DIRS = [
  'Code',
  'Code - Insiders',
  'Code - Exploration',
  'VSCodium',
  'VSCodium - Insiders',
  'Cursor',
  'Cursor Nightly',
  'Windsurf',
  'Windsurf - Next',
  'Antigravity',
  'Devin',
  'Trae',
  'Trae CN',
  'Positron'
];

// Parent directories that hold per-product folders like `Code/User/workspaceStorage`.
function appDataParents(): string[] {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32': {
      const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
      const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
      return [roaming, local];
    }
    case 'linux':
      return [process.env.XDG_CONFIG_HOME ?? path.join(home, '.config')];
    default: // darwin
      return [path.join(home, 'Library', 'Application Support')];
  }
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

// Scan each app-data parent for any `<product>/User/workspaceStorage` directory.
// This picks up VS Code, Insiders, VSCodium, Cursor, Windsurf, Antigravity, Devin, etc.
function discoverWorkspaceStorageRoots(): string[] {
  const roots = new Set<string>();

  for (const parent of appDataParents()) {
    const discovered = new Set<string>(KNOWN_PRODUCT_DIRS);
    try {
      for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          discovered.add(entry.name);
        }
      }
    } catch {
      // Parent may not exist on this machine; fall back to the known list.
    }

    for (const product of discovered) {
      const root = path.join(parent, product, 'User', 'workspaceStorage');
      if (isDirectory(root)) {
        roots.add(root);
      }
    }
  }

  return [...roots];
}

function defaultWorkspaceStorageRoot(): string {
  return path.join(appDataParents()[0], 'Code', 'User', 'workspaceStorage');
}

function resolveWorkspaceStorageRoots(): string[] {
  const override = process.env.VSCODE_WORKSPACE_STORAGE_ROOT;
  if (override && override.trim()) {
    // Allow multiple roots separated by the OS path delimiter (`;` on Windows, `:` elsewhere).
    const roots = override
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (roots.length > 0) {
      return roots;
    }
  }

  const discovered = discoverWorkspaceStorageRoots();
  return discovered.length > 0 ? discovered : [defaultWorkspaceStorageRoot()];
}

export function loadConfig(): ServerConfig {
  return {
    port: Number(process.env.PORT ?? 4317),
    workspaceStorageRoots: resolveWorkspaceStorageRoots(),
    directCopilotSessionRoot: process.env.VSCODE_COPILOT_SESSION_ROOT,
    pollIntervalMs: Number(process.env.SESSION_POLL_INTERVAL_MS ?? 30_000)
  };
}
