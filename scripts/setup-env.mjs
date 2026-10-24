import { randomBytes } from 'node:crypto';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../.env', import.meta.url));
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const content = template.replace('POSTGRES_PASSWORD=replace-with-your-local-password',
  `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}`)
  .replace('APP_DB_PASSWORD=replace-with-a-separate-runtime-password', `APP_DB_PASSWORD=${randomBytes(32).toString('hex')}`)
  .replace('AUTH_JWT_SECRET=replace-with-64-random-hex-characters', `AUTH_JWT_SECRET=${randomBytes(32).toString('hex')}`);

try {
  await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  console.log('Created local .env with generated database and JWT secrets.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const existing = await readFile(target, 'utf8');
  const missing = ['AUTH_JWT_SECRET', 'APP_DB_PASSWORD'].filter(key => !new RegExp(`^${key}=`, 'm').test(existing));
  if (missing.length) await appendFile(target, `\n${missing.map(key => `${key}=${randomBytes(32).toString('hex')}`).join('\n')}\n`);
  console.log(missing.length ? 'Added missing secrets to existing .env; previous settings were preserved.' : 'Local .env already exists; its settings were preserved.');
}
