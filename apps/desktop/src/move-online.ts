import { randomUUID } from 'crypto';
import { createWriteStream, openAsBlob } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { Logger } from './log.js';
import { paths } from './paths.js';

export type MoveStep = 'checking' | 'account' | 'backup' | 'pausing' | 'exporting' | 'uploading' | 'finishing';

export type MoveInput = { server: string; ownerEmail: string; ownerPassword: string };

export type MoveResult = { businessId: string; businessCode: string; businessName: string; server: string };

type Dependencies = {
  log: Logger;
  /** The local API's address; the move runs while it is up. */
  localApi: () => string;
  /** The page's sign-in token (an admin's), for the local API. */
  token: string;
  /** Checks the address is an online Point of Sale server; returns it tidied. */
  checkServer: (address: string) => Promise<string>;
  backup: () => Promise<unknown>;
  importId: () => string | null;
  saveImportId: (id: string | null) => void;
  /** The server runs a newer version than this app. */
  onUpdateNeeded: () => void;
  progress: (step: MoveStep) => void;
};

/** The error message an API sent, or a fallback. */
async function failure(res: Response, fallback: string) {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === 'string') return body.message;
    if (Array.isArray(body.message)) return body.message.join(', ');
  } catch {
    // Not JSON.
  }
  return `${fallback} (${res.status})`;
}

async function json<T>(res: Response, fallback: string) {
  if (!res.ok) throw new Error(await failure(res, fallback));
  return (await res.json()) as T;
}

/**
 * Moves this computer's business to an online server, in one go:
 * check the server (and that it runs this app's database version) → owner account → backup →
 * pause changes here → export → upload → mark this copy as moved.
 * If anything fails before the server has the business, this computer carries on as before.
 * After that point a retry finishes the same move (same import id), never a second business.
 */
export async function moveOnline(input: MoveInput, deps: Dependencies): Promise<MoveResult> {
  const local = deps.localApi();
  const auth = { authorization: `Bearer ${deps.token}` };

  deps.progress('checking');
  const server = await deps.checkServer(input.server);
  const [remote, here] = await Promise.all([
    fetch(`${server}/meta`).then((res) => json<{ schemaVersion: string | null }>(res, 'The server did not answer')),
    fetch(`${local}/meta`).then((res) => json<{ schemaVersion: string | null }>(res, 'The local service did not answer'))
  ]);
  if (remote.schemaVersion && here.schemaVersion && remote.schemaVersion !== here.schemaVersion) {
    if (here.schemaVersion < remote.schemaVersion) {
      deps.onUpdateNeeded();
      throw new Error('The server runs a newer version of the app. Update this app (it is downloading now), then move online.');
    }
    throw new Error("The server hasn't been updated to this app's version yet. Try again later.");
  }

  deps.progress('account');
  const account = await json<{ token: string }>(
    await fetch(`${server}/accounts/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: input.ownerEmail, password: input.ownerPassword })
    }),
    "Couldn't sign in to your owner account"
  );

  deps.progress('backup');
  await deps.backup();

  deps.progress('pausing');
  await json(await fetch(`${local}/migration/begin`, { method: 'POST', headers: auth }), "Couldn't pause this computer");

  const folder = join(paths.userData(), 'move-online');
  const bundle = join(folder, 'business.zip');
  let uploaded = false;
  let uncertain = false;
  try {
    deps.progress('exporting');
    await mkdir(folder, { recursive: true });
    const exported = await fetch(`${local}/migration/export`, { headers: auth });
    if (!exported.ok || !exported.body) throw new Error(await failure(exported, "Couldn't export the business"));
    await pipeline(Readable.fromWeb(exported.body as import('stream/web').ReadableStream), createWriteStream(bundle));

    deps.progress('uploading');
    let importId = deps.importId();
    if (!importId) {
      importId = randomUUID();
      deps.saveImportId(importId);
    }
    const form = new FormData();
    form.set('importId', importId);
    form.set('bundle', await openAsBlob(bundle), 'business.zip');
    let response: Response;
    try {
      response = await fetch(`${server}/businesses/import`, {
        method: 'POST',
        headers: { authorization: `Bearer ${account.token}` },
        body: form,
        signal: AbortSignal.timeout(60 * 60 * 1000)
      });
    } catch {
      // No answer: the server may or may not have the business. Stay paused so nothing is
      // sold here that the online copy would miss; a retry (same import id) settles it.
      uncertain = true;
      throw new Error("The upload didn't get an answer. Check the internet connection and try again; this computer stays paused until then.");
    }
    if (!response.ok) {
      // The server said no, so it has nothing: a later attempt starts afresh.
      deps.saveImportId(null);
    }
    const created = await json<{ business: { id: string; code: string; name: string } }>(response, 'The server could not take the business');
    uploaded = true;

    deps.progress('finishing');
    await json(
      await fetch(`${local}/migration/complete`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ businessId: created.business.id, businessCode: created.business.code, server })
      }),
      "Couldn't finish on this computer"
    );
    deps.saveImportId(null);
    deps.log(`Moved online as ${created.business.code} on ${server}`);
    return { businessId: created.business.id, businessCode: created.business.code, businessName: created.business.name, server };
  } catch (error) {
    deps.log(`Moving online failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!uploaded && !uncertain) {
      // The server doesn't have it: carry on offline.
      await fetch(`${local}/migration/abort`, { method: 'POST', headers: auth }).catch(() => undefined);
    }
    throw new Error(
      uploaded
        ? `${error instanceof Error ? error.message : String(error)}. The business is online; try again to finish.`
        : error instanceof Error
          ? error.message
          : String(error)
    );
  } finally {
    await rm(bundle, { force: true });
  }
}
