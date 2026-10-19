import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

export function createLocalStorage(directory) {
  const root = resolve(directory);
  function pathFor(key) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    const path = resolve(root, key);
    if (dirname(path) !== root) throw new Error('Invalid storage path');
    return path;
  }
  return {
    async save(key, buffer) {
      const file = await open(pathFor(key), 'wx', 0o600);
      try { await file.writeFile(buffer); await file.sync(); }
      catch (error) { await file.close(); await unlink(pathFor(key)).catch(() => {}); throw error; }
      await file.close();
    },
    async open(key) {
      const file = await open(pathFor(key), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile()) throw new Error('Storage object is not a regular file');
        return { stream: file.createReadStream(), size: stat.size };
      } catch (error) { await file.close(); throw error; }
    },
    async remove(key) {
      try { await unlink(pathFor(key)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
  };
}
