import { Dialog } from 'siyuan';
export function requestDocumentTitle(create: (title: string) => Promise<void>): () => void {
  const dialog = new Dialog({ title: '新建文档', content: '<form class="yzc-create"><label>文档名称<input class="b3-text-field" name="title" required autocomplete="off"></label><div role="status"></div><button type="submit" class="b3-button">创建</button></form>', width: '360px' });
  const form = dialog.element.querySelector('form')!;
  const input = form.querySelector('input')!;
  const button = form.querySelector('button')!;
  let closed = false;
  const close = () => { if (!closed) { closed = true; form.onsubmit = null; dialog.destroy(); } };
  form.onsubmit = event => {
    event.preventDefault(); if (button.disabled || !input.value.trim()) return;
    button.disabled = true;
    void create(input.value).then(close).catch(error => {
      if (closed) return;
      form.querySelector('[role="status"]')!.textContent = error instanceof Error ? error.message : String(error);
      button.textContent = '请关闭窗口后检查文档';
    });
  };
  input.focus();
  return close;
}
