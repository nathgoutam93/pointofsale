import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { once } from 'events';
import { dirname, join } from 'path';
import yauzl from 'yauzl';

/**
 * Unpacks a zip into `dir`. Refuses entries that would land outside it (.., absolute paths,
 * backslashes) and archives that unpack to more than `maxBytes`, so an uploaded file can
 * neither write elsewhere nor fill the disk.
 */
export function extractZip(file: string, dir: string, maxBytes: number) {
  return new Promise<void>((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(new Error('The file is not a valid zip archive'));
      let total = 0;
      zip.on('error', reject);
      zip.on('end', () => resolve());
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName;
        if (name.endsWith('/')) return zip.readEntry();
        const parts = name.split('/');
        if (name.startsWith('/') || name.includes('\\') || parts.some((part) => part === '..' || part === '' || part === '.')) {
          zip.close();
          return reject(new Error(`Unexpected file in the archive: ${name}`));
        }
        total += entry.uncompressedSize;
        if (total > maxBytes) {
          zip.close();
          return reject(new Error('The archive is too large'));
        }
        zip.openReadStream(entry, async (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error(`Couldn't read ${name}`));
          try {
            const target = join(dir, ...parts);
            await mkdir(dirname(target), { recursive: true });
            const out = createWriteStream(target);
            stream.pipe(out);
            await once(out, 'close');
            zip.readEntry();
          } catch (writeError) {
            reject(writeError);
          }
        });
      });
      zip.readEntry();
    });
  });
}
