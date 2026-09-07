import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=await mkdtemp(path.join(tmpdir(),'pond-staging-isolation-'));
try {
 await mkdir(path.join(dir,'apps/api/src/config'),{recursive:true});
 await mkdir(path.join(dir,'apps/api/src/utils'),{recursive:true});
 await mkdir(path.join(dir,'apps/web'),{recursive:true});
 await writeFile(path.join(dir,'package.json'),'{"type":"module"}');
 await symlink(path.join(repo,'node_modules'),path.join(dir,'node_modules'),'dir');
 await symlink(path.join(repo,'apps/web/node_modules'),path.join(dir,'apps/web/node_modules'),'dir');
 for(const file of ['apps/api/src/config/env.js','apps/api/src/utils/supabaseConfig.js','apps/web/vite.config.js']) await copyFile(path.join(repo,file),path.join(dir,file));
 const poison='UNEXPECTED_ENV_LEAK=present\nVITE_API_BASE=https://wrong.invalid\nRESEND_API_KEY=not-a-real-provider-key\n';
 for(const file of ['.env','.env.local','apps/api/.env','apps/web/.env','apps/web/.env.local'])await writeFile(path.join(dir,file),poison);
 for(const flag of ['PONDBRIDGE_ISOLATED_ENV','PONDBRIDGE_LOCAL_STAGING']){
  const code=`await import('./apps/api/src/config/env.js');const {default:config}=await import('./apps/web/vite.config.js');const resolved=config({command:'serve'}); console.log(JSON.stringify({leak:process.env.UNEXPECTED_ENV_LEAK||null,api:process.env.VITE_API_BASE,email:process.env.RESEND_API_KEY||'',envDir:resolved.envDir}));`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:'development',[flag]:'1',AUTH_PROVIDER:'legacy',JWT_SECRET:'isolated-test-only',SUPABASE_URL:'https://isolated.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',VITE_API_BASE:'http://127.0.0.1:4010'}});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()),{leak:null,api:'http://127.0.0.1:4010',email:'',envDir:false});
 }
 console.log('PASS: local and remote staging ignore root/app dotenv files and disable Vite automatic env loading.');
}finally{await rm(dir,{recursive:true,force:true});}
