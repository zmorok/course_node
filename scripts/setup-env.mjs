import { randomBytes } from 'node:crypto';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../.env', import.meta.url));
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const content = template.replace('POSTGRES_PASSWORD=replace-with-your-local-password',
  `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}`)
  .replace('AUTH_JWT_SECRET=replace-with-64-random-hex-characters', `AUTH_JWT_SECRET=${randomBytes(32).toString('hex')}`);

try {
  await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  console.log('Created local .env with generated database and JWT secrets.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const existing = await readFile(target, 'utf8');
  if (!/^AUTH_JWT_SECRET=/m.test(existing)) {
    await appendFile(target, `\nAUTH_JWT_SECRET=${randomBytes(32).toString('hex')}\n`);
    console.log('Added a generated JWT secret to existing .env; previous settings were preserved.');
  } else {
    console.log('Local .env already exists; its settings were preserved.');
  }
}
