import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {OFFLINE_ASSETS} from '../offline-assets.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const reservation=net.createServer();
reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;
await new Promise(resolve=>reservation.close(resolve));
const child=spawn(process.execPath,['server.mjs'],{
  cwd:root,env:{...process.env,PORT:String(port),BASE_PATH:'/the-shelf/',RUNTIME_ONLY:'1'},stdio:['ignore','pipe','pipe'],
});
let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
const base=`http://127.0.0.1:${port}/the-shelf/`;
try{
  let ready=false;
  for(let i=0;i<40;i++){
    if(child.exitCode!==null)throw new Error(`Preview exited: ${output}`);
    try{const response=await fetch(base);if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(ready,`Preview started: ${output}`);
  const home=await fetch(base),html=await home.text();
  assert.match(html,/<title>The shelf<\/title>/);assert.match(html,/id="settings-advanced-tab"/);
  assert.match(html,/<button id="interface-toggle"[^>]*aria-label="Hide interface"[^>]*aria-pressed="false"/);
  assert.match(html,/<button id="card-action-toggle"[^>]*aria-label="Close card"[^>]*hidden>/);
  assert.match(html,/<nav id="edge-card-navigation"[^>]*hidden>/);
  assert.match(html,/<button id="edge-previous-card"[^>]*aria-label="Previous card"/);
  assert.match(html,/<button id="edge-next-card"[^>]*aria-label="Next card"/);
  assert.match(html,/id="offline-state"/);assert.doesNotMatch(html,/id="offline-install(?:"|-help|-ios)/);
  assert.equal(home.headers.get('x-shelf-preview'),'runtime-only');
  assert.equal(home.headers.get('cache-control'),'no-store');
  assert.equal(home.headers.get('x-content-type-options'),'nosniff');
  const general=html.slice(html.indexOf('id="settings-general"'),html.indexOf('id="settings-advanced"'));
  const compatibilityLink=general.match(/<a id="compatibility-mode-link"[^>]*href="([^"]+)"/);
  assert.ok(compatibilityLink,'General settings links to compatibility mode.');
  const compatibilityUrl=new URL(compatibilityLink[1],base);
  assert.equal(compatibilityUrl.pathname,'/the-shelf/compatibility/');
  const compatibility=await fetch(compatibilityUrl),compatibilityHtml=await compatibility.text();
  assert.equal(compatibility.status,200);
  assert.match(compatibilityHtml,/href="compatibility\.css"/);
  assert.match(compatibilityHtml,/src="compatibility\.js"/);
  assert.match(compatibilityHtml,/href="\.\.\/index\.html"/);
  assert.doesNotMatch(compatibilityHtml,/three\.module|src="scene\.js"/);
  const files=[...new Set([...OFFLINE_ASSETS,'compatibility/index.html','compatibility/compatibility.css','compatibility/compatibility.js'])];
  await Promise.all(files.map(async path=>{
    const response=await fetch(new URL(path,base));assert.equal(response.status,200,path);await response.arrayBuffer();
  }));
  for(const path of ['README.md','AGENTS.md','server.mjs','checks/run-checks.mjs','scripts/start-private-preview.ps1',
    '.preview/private-preview.json','.git/config','compatibility/assets/scans/manifest.json','../README.md','%2e%2e/README.md',
    'compatibility/%2e%2e%2fREADME.md','compatibility%5c..%5cREADME.md','shelf/','shelf/index.html']){
    const response=await fetch(new URL(path,base));assert.equal(response.status,404,`Private preview must not serve ${path}`);
  }
  const redirect=await fetch(`http://127.0.0.1:${port}/`,{redirect:'manual'});
  assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'/the-shelf/');
  const head=await fetch(base,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const post=await fetch(base,{method:'POST'});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');
  const manifest=await fetch(new URL('manifest.webmanifest',base));assert.match(manifest.headers.get('content-type'),/application\/manifest\+json/);
  const image=await fetch(new URL(OFFLINE_ASSETS.find(path=>path.endsWith('.webp')),base));assert.equal(image.headers.get('content-type'),'image/webp');
  console.log(`Private-preview server checks passed: ${files.length} runtime files, Settings/compatibility navigation, prefix/MIME/HEAD behaviour and blocked internal/retired paths.`);
}finally{
  if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
}
