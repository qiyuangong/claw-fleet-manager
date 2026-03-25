// packages/server/src/services/dir-utils.ts
import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function getDirectorySize(path: string): Promise<number> {
  try {
    const stats = await stat(path);
    if (!stats.isDirectory()) {
      return stats.size;
    }
    const entries = await readdir(path);
    const sizes = await Promise.all(
      entries.map((entry) => getDirectorySize(join(path, entry))),
    );
    return sizes.reduce((total, size) => total + size, 0);
  } catch {
    return 0;
  }
}
