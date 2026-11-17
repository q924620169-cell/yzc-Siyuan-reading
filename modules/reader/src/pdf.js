const MiB = 1024 * 1024;
const chunkSize = 4 * MiB;
export const pdfLimit = 512 * MiB;
export const isPDF = name => /\.pdf$/i.test(name);
export const pdfAssetName = name => Array.from(name.replace(/\.pdf$/i,'')).slice(0,80).join('')+'.pdf';

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

// The same fixed-size chunks are used for local files and streamed HTTP responses.
async function fingerprint(chunks, size, onProgress) {
  const hashes = new Uint8Array(Math.ceil(size / chunkSize) * 32);
  const block = new Uint8Array(Math.min(size, chunkSize));
  let used = 0, seen = 0, index = 0;
  for await (const bytes of chunks) {
    if (seen + bytes.length > size) throw Error('PDF 副本大小与原件不同');
    for (let offset = 0; offset < bytes.length;) {
      const length = Math.min(block.length - used, bytes.length - offset);
      block.set(bytes.subarray(offset, offset + length), used);
      offset += length;
      used += length;
      seen += length;
      if (used === block.length || seen === size) {
        hashes.set(await sha256(block.subarray(0, used)), index++ * 32);
        used = 0;
        onProgress?.(seen, size);
      }
    }
  }
  if (seen !== size) throw Error('PDF 副本大小与原件不同');
  return 'pdf1-' + [...await sha256(hashes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function pdfFingerprint(file, onProgress) {
  async function* chunks() {
    for (let start = 0; start < file.size; start += chunkSize) {
      yield new Uint8Array(await file.slice(start, start + chunkSize).arrayBuffer());
    }
  }
  return fingerprint(chunks(), file.size, onProgress);
}

export async function verifyPDF(response, size, expected, onProgress) {
  if (!response.ok || !response.body) throw Error('无法读取 PDF 副本');
  const reader = response.body.getReader();
  async function* chunks() {
    try {
      for (;;) {
        const {value, done} = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  if (await fingerprint(chunks(), size, onProgress) !== expected) throw Error('PDF 副本校验失败');
}

const metadataWindow = 128 * 1024;
const latin = new TextDecoder('windows-1252');
const whitespace = '[\\x00\\t\\n\\f\\r ]';

function metadataString(dictionary, key) {
  const match = dictionary.match(new RegExp('/' + key + whitespace + '+(\\((?:[^()\\\\]|\\\\[()\\\\])*\\)|<(?:[0-9a-fA-F\\s])+>)'));
  if (!match) return '';
  const value = match[1];
  const hex = value.startsWith('<') ? value.slice(1, -1).replace(/\s/g, '') : '';
  let text = value.slice(1, -1).replace(/\\([()\\])/g, '$1');
  if (hex) {
    const bytes = Uint8Array.from(hex.match(/../g) || [], v => parseInt(v, 16));
    if (bytes[0] === 254 && bytes[1] === 255 && hex.length % 4 === 0) text = new TextDecoder('utf-16be').decode(bytes);
    else if (bytes.length * 2 === hex.length && bytes.every(b => b >= 32 && b <= 126)) text = latin.decode(bytes);
    else return '';
  } else if (!/^[\x20-\x7e]+$/.test(text)) return '';
  return text.length <= 300 && !/[\p{C}\uFFFD]/u.test(text) ? text.trim() : '';
}

export async function inspectPDF(file) {
  if (file.size > pdfLimit) throw Error('PDF 超过书房单文件导入上限 512 MiB');
  const head = latin.decode(await file.slice(0, Math.min(file.size, metadataWindow)).arrayBuffer());
  if (!/^%PDF-\d\.\d/.test(head)) throw Error('文件没有有效的 PDF 文件头');
  const tail = file.size <= metadataWindow ? head : latin.decode(await file.slice(-metadataWindow).arrayBuffer());
  if (!/%%EOF[\x00\t\n\f\r ]*$/.test(tail)) throw Error('PDF 文件不完整，缺少结束标记');

  // Read only a simple, unencrypted Info dictionary referenced by the final trailer.
  const trailer = tail.match(/\btrailer\s*<<((?:(?!>>)[\s\S])*)>>\s*startxref\s+\d+\s+%%EOF\s*$/)?.[1]?.replace(/%[^\r\n]*/g,'');
  const info = trailer && !/\/Encrypt\b/.test(trailer) && trailer.match(/\/Info\s+(\d+)\s+(\d+)\s+R\b/);
  const dictionary = info && (tail.match(new RegExp('(?:^|[\\r\\n])' + info[1] + '\\s+' + info[2] + '\\s+obj\\s*<<([\\s\\S]{0,4096}?)>>\\s*endobj')) ||
    head.match(new RegExp('(?:^|[\\r\\n])' + info[1] + '\\s+' + info[2] + '\\s+obj\\s*<<([\\s\\S]{0,4096}?)>>\\s*endobj')))?.[1];
  return {
    title: (dictionary && metadataString(dictionary, 'Title')) || file.name.replace(/\.pdf$/i, ''),
    author: (dictionary && metadataString(dictionary, 'Author')) || '',
  };
}

// A fast update check combines filesystem metadata and content samples. Changed
// or relocated files fall back to the full chunk fingerprint.
export async function pdfStamp(file) {
  const sampleSize = 64 * 1024;
  const samples = await Promise.all([0, Math.max(0, Math.floor((file.size - sampleSize) / 2)), Math.max(0, file.size - sampleSize)]
    .map(start => file.slice(start, start + sampleSize).arrayBuffer()));
  const sample = [...await sha256(await new Blob(samples).arrayBuffer())].map(b => b.toString(16).padStart(2, '0')).join('');
  return {size:file.size, modified:file.lastModified, sample};
}
