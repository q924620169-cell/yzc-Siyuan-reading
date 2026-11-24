import {api} from './storage.js';
import {button,el,field,modal,report} from './dom.js';

async function appendNote(id,content) {
  await api('/api/block/appendBlock',{parentID:id,dataType:'markdown',data:content});
  return id;
}

async function saveToInbox(target,content) {
  const {id:notebook}=await target();
  const path='/阅读摘录';
  const ensure=async()=>{
    for(let attempt=0;;attempt++){
      try{
        const [id]=await api('/api/filetree/getIDsByHPath',{notebook,path})??[];
        if(id)return await appendNote(id,content);
        return await api('/api/filetree/createDocWithMd',{notebook,path,markdown:content});
      }catch(error){
        if(error.reason!=='indexUnavailable'||attempt>=19)throw error;
        await new Promise(resolve=>setTimeout(resolve,250));
      }
    }
  };
  return globalThis.navigator?.locks?.request('yzc-reading:inbox-notes',ensure)??ensure();
}

export function saveReaderNote(ui,item) {
  const title=ui.current.title.replace(/[\[\]]/g,'');
  const content=`> ${item.text.replace(/\n/g,'\n> ')}\n\n${item.thought||''}\n\n来源：《${title}》${item.chapter?' · '+item.chapter:''}`;
  return modal('保存摘录',(body,footer,close)=>{
    const quick=el('div','yr-note-destinations'),search=field('查找其他文档');
    const form=el('form','yr-note-destinations'),results=el('div','yr-search-results'),status=el('p','yr-muted');
    search.input.type='search';status.setAttribute('role','status');body.append(quick,form,status,results);
    let dialog, saving=false, searchVersion=0;
    const text=value=>{status.textContent=value;};
    const save=async(label,write)=>{
      if(saving)return;
      saving=true;dialog=body.closest('dialog');dialog.dataset.busy='true';
      const controls=[...body.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
      controls.forEach(node=>node.disabled=true);text('正在保存摘录…');
      try{
        const id=await write();
        ui.library.config.lastNoteTarget={id,label};
        void ui.library.saveConfig().catch(()=>report(Error('摘录已保存，未能记住此次保存位置。')));
        dialog.dataset.busy='false';
        dialog.querySelector('h2').textContent='摘录已保存';
        const confirmation=el('p','','已保存到 '+label);
        confirmation.setAttribute('role','status');
        body.replaceChildren(confirmation);
        const done=button('完成',close);
        footer.replaceChildren(done,button('打开文档',async()=>{await ui.openDoc(id);close();}));
        done.focus();
      }catch(error){
        text(error.message||'保存失败，请重试。');
      }finally{
        dialog.dataset.busy='false';saving=false;controls.forEach(node=>node.disabled=false);
      }
    };
    const last=ui.library.config.lastNoteTarget;
    if(last?.id&&last?.label){
      quick.append(button('存到上次位置 · '+last.label,()=>save(last.label,async()=>{
        try{await api('/api/filetree/getPathByID',{id:last.id});}
        catch{throw Error('无法打开上次的文档，请改选保存位置。');}
        return appendNote(last.id,content);
      })));
    }
    if(ui.uncategorized)quick.append(button('存到未分类',()=>save('未分类 / 阅读摘录',()=>saveToInbox(ui.uncategorized,content))));
    const find=button('查找',()=>{});find.type='submit';form.append(search.wrap,find);
    form.onsubmit=event=>{
      event.preventDefault();
      const q=search.input.value.trim();if(!q||saving)return;
      const version=++searchVersion;
      results.replaceChildren();text('正在查找文档…');
      void api('/api/filetree/searchDocs',{k:q}).then(docs=>{
        if(!body.isConnected||saving||version!==searchVersion)return;
        text(docs.length?'':'没有找到文档，请换一个关键词。');
        for(const doc of docs.slice(0,30)){
          const id=doc.id||doc.path.split('/').pop().replace(/\.sy$/,'');
          const label=doc.hPath||doc.name||id;
          results.append(button(label,()=>save(label,()=>appendNote(id,content))));
        }
      }).catch(error=>{if(body.isConnected&&version===searchVersion)text(error.message);});
    };
  });
}
