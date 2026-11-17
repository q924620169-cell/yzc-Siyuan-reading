import type {ImageCache} from './cache';
import {digest,type Article} from './model';

/** Copy validated cached bytes into the document asset store, outside RSS cache lifetime.
 * A deterministic name also recovers an upload whose response was lost. */
export function permanentCover(cache:ImageCache,signal:AbortSignal):(article:Article)=>Promise<string>{
  return async article=>{
    const source=article.previewCover||article.cover;
    if(!source)throw Error('文章未提供封面。');
    const url=await cache.get(source);if(!url)throw Error('封面暂时无法读取，尚未完成导入，请稍后重试。');
    const response=await fetch(url,{signal});if(!response.ok)throw Error('读取题头图失败。');
    const blob=await response.blob(),ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'} as Record<string,string>)[blob.type];
    if(!ext||!blob.size||blob.size>8_000_000)throw Error('封面格式或大小不符合题头图要求。');
    const name=`yzc-rss-${await digest(article.id)}.${ext}`,asset=`assets/${name}`,path=`/data/${asset}`;
    const previous=await fetch('/api/file/getFile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path}),signal});
    if(previous.ok&&previous.headers.get('Content-Type')?.startsWith('image/')&&(await previous.blob()).size>0)return asset;
    if(!previous.ok&&previous.status!==404&&previous.status!==202)throw Error(`题头图资源检查失败：HTTP ${previous.status}`);
    if(previous.headers.get('Content-Type')?.includes('json')){const result=await previous.json();if(result.code!==404)throw Error(result.msg||'题头图资源检查失败。');}
    const form=new FormData();form.append('path',path);form.append('file',blob,name);
    const written=await fetch('/api/file/putFile',{method:'POST',body:form,signal});
    if(!written.ok)throw Error(`题头图资源保存失败：HTTP ${written.status}`);
    const result=await written.json();if(result.code!==0)throw Error(result.msg||'题头图资源保存失败。');
    return asset;
  };
}
