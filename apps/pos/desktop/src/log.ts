import { app } from 'electron';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { paths } from './paths.js';

export type Logger = (message: string) => void;

/** Appends timestamped lines to userData/logs/<name>.log (and the console when unpackaged). */
export function logger(name: string): Logger {
  return (message: string) => {
    const lines = message
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => `${new Date().toISOString()} ${line}\n`)
      .join('');
    if (!lines) return;
    try {
      mkdirSync(paths.logs(), { recursive: true });
      appendFileSync(join(paths.logs(), `${name}.log`), lines);
    } catch {
      // Logging must never take the app down.
    }
    if (!app.isPackaged) process.stdout.write(`[${name}] ${lines}`);
  };
}
