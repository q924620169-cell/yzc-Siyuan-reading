import {build} from 'esbuild';
import {mkdir,copyFile,cp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import {zipSync,unzipSync} from 'fflate';
import {createHash} from 'node:crypto';
import {scopeCss} from './scope-css.mjs';
import {rendererCompat} from './renderer-compat.mjs';

const out=path.resolve('dist/package');
if(path.dirname(out)!==path.resolve('dist'))throw Error('Unexpected build output');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await build({entryPoints:['plugin/src/index.ts'],bundle:true,platform:'browser',format:'cjs',target:'chrome120',external:['siyuan','/plugins/*'],outfile:out+'/index.js',footer:{js:'module.exports = module.exports.default;'}});
await build({entryPoints:['modules/reader/src/engine.js'],outdir:out+'/reader',bundle:true,splitting:true,format:'esm',platform:'browser',target:'chrome120',minify:true,plugins:[{name:'chromium-book-sandbox',setup(b){b.onLoad({filter:/paginator\.js$/},async args=>{let contents=rendererCompat(await readFile(args.path,'utf8'));for(const[from,to]of[["'allow-same-origin allow-scripts'","'allow-same-origin'"],['    render() {\n        if (!this.#view) return','    render() {\n        if (!this.#view?.document?.body) return'],['    #afterScroll(reason) {\n','    #afterScroll(reason) {\n        if (!this.#view?.document?.body) return\n']]){if(!contents.includes(from))throw Error('Pinned paginator compatibility patch changed');contents=contents.replace(from,to);}return{contents,loader:'js'};});}}]});
await build({entryPoints:['visual/index.css'],bundle:true,outfile:out+'/index.css',loader:{'.ttf':'file'},assetNames:'fonts/[name]',publicPath:'/plugins/yzc-INL'});
const css=[await readFile(out+'/index.css','utf8')];
for(const file of ['plugin.css','host-navigation.css','launcher.css','spaces.css'])css.push(await readFile('plugin/styles/'+file,'utf8'));
// Reader and RSS already scope their UI rules; keep native PDF host selectors intact.
await writeFile(out+'/index.css',(scopeCss(css.join('\n'))+'\n'+await readFile('modules/reader/src/style.css','utf8')+'\n'+await readFile('modules/rss/src/styles.css','utf8')).replaceAll('\r\n','\n'));
await cp('assets',out+'/assets',{recursive:true});await cp('i18n',out+'/i18n',{recursive:true});
await mkdir(out+'/licenses',{recursive:true});await cp('licenses',out+'/licenses',{recursive:true});
for(const font of ['newsreader','lxgw-wenkai-screen','lxgw-zhenkai'])await copyFile(`visual/fonts/${font}/OFL.txt`,`${out}/licenses/${font}-OFL.txt`);
await copyFile('modules/reader/vendor/foliate-js/LICENSE',out+'/licenses/foliate-js.txt');
await copyFile('modules/reader/licenses/pdfjs.txt',out+'/licenses/pdfjs.txt');
const manifest=JSON.parse(await readFile('plugin/plugin.json','utf8'));
await writeFile(out+'/plugin.json',JSON.stringify(manifest,null,2)+'\n');
for(const file of ['README.md','README.zh-CN.md','LICENSE','FONT-NOTICES.md','SOURCE-BASELINES.json'])await writeFile(out+'/'+file,(await readFile(file,'utf8')).replaceAll('\r\n','\n'));
const dependencies=['dompurify','@mozilla/readability','turndown','@zip.js/zip.js','markdown-it','argparse','entities','linkify-it','mdurl','punycode.js','uc.micro','fflate'];
for(const name of dependencies){const root='node_modules/'+name;const license=(await readdir(root)).find(n=>/^licen[cs]e(?:[.-]|$)/i.test(n));if(!license)throw Error('Missing license: '+name);await copyFile(root+'/'+license,out+'/licenses/'+name.replaceAll('/','-')+'.txt');}
const files={};
async function collect(dir,prefix=''){for(const e of await readdir(dir,{withFileTypes:true})){const key=prefix+e.name;if(e.isDirectory())await collect(path.join(dir,e.name),key+'/');else files[key]=new Uint8Array(await readFile(path.join(dir,e.name)));}}
await collect(out);
for(const f of ['index.js','index.css','reader/engine.js','fonts/Newsreader-VF.ttf','fonts/LXGWWenKaiScreen.ttf','fonts/LXGWZhenKaiGB-Regular.ttf','assets/rss/later-filled-anthropic.svg'])if(!files[f])throw Error('Missing asset: '+f);
const runtime=new TextDecoder().decode(files['index.js'])+new TextDecoder().decode(files['index.css']);
if(/\/plugins\/yzc-(Reader|RSS)\//.test(runtime))throw Error('Legacy plugin asset dependency');
if(manifest.name!=='yzc-INL')throw Error('Identity must stay yzc-INL');
const zip=zipSync(files,{level:6,mtime:new Date('2020-01-01T00:00:00Z')}),unpacked=unzipSync(zip);
for(const [name,bytes]of Object.entries(files))if(!Buffer.from(bytes).equals(Buffer.from(unpacked[name])))throw Error('ZIP mismatch: '+name);
await writeFile('dist/package.zip',zip);await writeFile('dist/package.sha256',createHash('sha256').update(zip).digest('hex')+'  package.zip\n');
await writeFile('dist/package-files.json',JSON.stringify(Object.keys(files),null,2));
console.log(`Built ${manifest.name} ${manifest.version}: ${Object.keys(files).length} files, one package.zip`);
