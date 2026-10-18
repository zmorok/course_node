import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../.env', import.meta.url));
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const content = template.replace('POSTGRES_PASSWORD=replace-with-your-local-password',
  `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}`);

try {
  await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  console.log('Created local .env with a generated database password. Existing files are never overwritten.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Local .env already exists; its settings were preserved.');
}
