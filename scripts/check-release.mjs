import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean),forbidden=/^(?:\.local|validation|node_modules|dist|data|conf|history|temp)\//;
const secrets=/(?:\bgh[pousr]_[A-Za-z0-9_]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
for(const file of tracked){if(forbidden.test(file)||/\.(?:epub|pdf|sya|db|zip)$/i.test(file))throw Error('Private/generated file tracked: '+file);const bytes=await readFile(file);if(!bytes.includes(0)&&secrets.test(bytes.toString('utf8')))throw Error('Credential-like content in tracked source: '+file);}
const historyPaths=execFileSync('git',['log','--all','--format=','--name-only'],{encoding:'utf8'}).split('\n').filter(Boolean);
if(historyPaths.some(p=>forbidden.test(p)||/\.(?:epub|pdf|sya|db|zip)$/i.test(p)))throw Error('Private/generated file in reachable history');
const objects=execFileSync('git',['rev-list','--all','--objects'],{encoding:'utf8'}).trim().split('\n').map(s=>s.split(' ')[0]);
const checked=execFileSync('git',['cat-file','--batch-check'],{input:objects.join('\n')+'\n',encoding:'utf8'}).trim().split('\n').filter(s=>s.split(' ')[1]==='blob').map(s=>s.split(' ')[0]);
const contents=execFileSync('git',['cat-file','--batch'],{input:checked.join('\n')+'\n',maxBuffer:180*1024*1024});let offset=0;
for(const id of checked){const end=contents.indexOf(10,offset),size=Number(contents.subarray(offset,end).toString().split(' ')[2]),bytes=contents.subarray(end+1,end+1+size);if(!bytes.includes(0)&&secrets.test(bytes.toString('utf8')))throw Error('Credential-like content in reachable history blob '+id);offset=end+size+2;}
const archive=await readFile('dist/package.zip'),files=unzipSync(archive),manifest=JSON.parse(new TextDecoder().decode(files['plugin.json']));
for(const name of ['plugin.json','index.js','index.css','icon.png','reader/engine.js','README.md','LICENSE'])if(!files[name])throw Error('Missing package root/resource: '+name);
if(manifest.name!=='yzc-Siyuan-reading'||manifest.displayName['zh-CN']!=='yzc阅读'||manifest.version!==JSON.parse(await readFile('package.json','utf8')).version)throw Error('Release manifest mismatch');
const supplied=await readFile('plugin/icon.png');if(!Buffer.from(files['icon.png']).equals(supplied)||supplied.length>65536)throw Error('Wordmark mismatch or too large');
for(const [name,bytes]of Object.entries(files)){if(forbidden.test(name)||secrets.test(new TextDecoder().decode(bytes)))throw Error('Private content in package: '+name);}
for(const name of ['index.js','index.css',...Object.keys(files).filter(n=>n.startsWith('reader/')&&n.endsWith('.js'))]){
 const text=new TextDecoder().decode(files[name]);if(/\/plugins\/yzc-(?:INL|Reader|RSS)\//.test(text))throw Error('Old plugin resource URL in '+name);
 for(const match of text.matchAll(/\/plugins\/yzc-Siyuan-reading\/([\w./-]+\.(?:ttf|svg|png|css|js))/g))if(!files[match[1]])throw Error('Resource URL missing from ZIP: '+match[1]);
}
const result={version:manifest.version,id:manifest.name,displayName:manifest.displayName['zh-CN'],trackedFiles:tracked.length,historyBlobsChecked:checked.length,packageFiles:Object.keys(files).length,sha256:createHash('sha256').update(archive).digest('hex'),wordmarkSha256:createHash('sha256').update(supplied).digest('hex'),privateDataScanPassed:true};
await mkdir('validation',{recursive:true});await writeFile('validation/release-audit.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
