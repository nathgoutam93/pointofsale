/**
 * What the desktop app (apps/desktop) exposes to the web app through its preload script.
 * In a plain browser there is no bridge and `desktop` is null.
 */
export type DesktopMode = 'offline' | 'online';

export type DesktopConfig = {
  /** null until the owner picks a business type on first launch. */
  mode: DesktopMode | null;
  /** The API this window talks to: the local API offline, the hosted one online. */
  apiBaseUrl: string | null;
};

export type ModeChoice = { mode: 'offline' } | { mode: 'online'; apiBaseUrl: string };

export type DesktopBridge = {
  config: DesktopConfig;
  version: string;
  /** Saves the choice, starts what it needs (the local database and API offline) and reloads the window. */
  chooseMode(choice: ModeChoice): Promise<void>;
  openLogsFolder(): Promise<void>;
};

declare global {
  interface Window {
    posDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' ? window.posDesktop ?? null : null;
