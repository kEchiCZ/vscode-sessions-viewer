import os from 'node:os';
import path from 'node:path';

export interface ServerConfig {
  port: number;
  workspaceStorageRoot: string;
  directCopilotSessionRoot?: string;
  pollIntervalMs: number;
}

function defaultWorkspaceStorageRoot(): string {
  const home = os.homedir();
  switch (os.platform()) {
    case 'win32':
      return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'workspaceStorage');
    case 'linux':
      return path.join(home, '.config', 'Code', 'User', 'workspaceStorage');
    default: // darwin
      return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage');
  }
}

export function loadConfig(): ServerConfig {
  return {
    port: Number(process.env.PORT ?? 4317),
    workspaceStorageRoot:
      process.env.VSCODE_WORKSPACE_STORAGE_ROOT ?? defaultWorkspaceStorageRoot(),
    directCopilotSessionRoot: process.env.VSCODE_COPILOT_SESSION_ROOT,
    pollIntervalMs: Number(process.env.SESSION_POLL_INTERVAL_MS ?? 30_000)
  };
}
