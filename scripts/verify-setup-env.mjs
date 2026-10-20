import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function verifySetupEnv(){
  const directory=await mkdtemp(join(tmpdir(),'workify-env-'));
  try {
    await mkdir(join(directory,'scripts'));
    await copyFile(new URL('./setup-env.mjs',import.meta.url),join(directory,'scripts','setup-env.mjs'));
    await copyFile(new URL('../.env.example',import.meta.url),join(directory,'.env.example'));
    const run=()=>exec(process.execPath,[join(directory,'scripts','setup-env.mjs')],{windowsHide:true,timeout:10000});
    const result=await run(),created=await readFile(join(directory,'.env'),'utf8');
    const password=/^POSTGRES_PASSWORD=([a-f0-9]{64})$/m.exec(created)?.[1],jwt=/^AUTH_JWT_SECRET=([a-f0-9]{64})$/m.exec(created)?.[1];
    assert(password&&jwt);assert.notEqual(password,jwt);assert(!result.stdout.includes(password));assert(!result.stdout.includes(jwt));
    await run();assert.equal(await readFile(join(directory,'.env'),'utf8'),created,'Setup must preserve existing secrets');
    const legacy='POSTGRES_PASSWORD=local-test-only\nFRONTEND_PORT=54321\n';await writeFile(join(directory,'.env'),legacy);await run();
    const upgraded=await readFile(join(directory,'.env'),'utf8');assert(upgraded.startsWith(legacy));assert.match(upgraded,/^AUTH_JWT_SECRET=[a-f0-9]{64}$/m);
    console.log('PASS: README environment setup generates secrets, preserves settings and upgrades legacy configuration');
  } finally {
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert(basename(directory).startsWith('workify-env-'));
    await rm(directory,{recursive:true,force:true});
  }
}
