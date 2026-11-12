import { navigationAction } from './web-shell-policy.ts';

export const PDF_CHUNK_BYTES = 256 * 1024;
export const MAX_PDF_EXPORT_BYTES = 100 * 1024 * 1024;
const maxMessage = Math.ceil(PDF_CHUNK_BYTES / 3) * 4 + 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Start = { type: 'flownote.pdf-export.start'; id: string; name: string; bytes: number };
type Chunk = { type: 'flownote.pdf-export.chunk'; id: string; index: number; base64: string };
type End = { type: 'flownote.pdf-export.finish' | 'flownote.pdf-export.cancel'; id: string };
type Message = Start | Chunk | End;
export type PdfExportStatus = { id: string; state: 'ready' | 'chunk' | 'complete' | 'cancelled' | 'error'; index?: number };
type Sink = { uri: string; append(bytes: Uint8Array): void; close(): void; remove(): void };
type Dependencies = {
  confirm(name: string, bytes: number): Promise<boolean>;
  open(name: string, id: string): Sink;
  share(uri: string, name: string): Promise<void>;
  notify(status: PdfExportStatus): void;
};

const parse = (raw: string, source: string, origin: string): Message => {
  if (navigationAction(source, origin) !== 'internal' || raw.length > maxMessage) throw new Error('Untrusted PDF export');
  const data = JSON.parse(raw);
  if (!data || Array.isArray(data) || typeof data.id !== 'string' || !uuid.test(data.id)) throw new Error('Invalid PDF transfer');
  const keys = Object.keys(data).sort().join(',');
  if (data.type === 'flownote.pdf-export.start' && keys === 'bytes,id,name,type'
    && typeof data.name === 'string' && data.name.length <= 512 && /\.pdf$/i.test(data.name)
    && Number.isSafeInteger(data.bytes) && data.bytes >= 5 && data.bytes <= MAX_PDF_EXPORT_BYTES) {
    const name = data.name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069:*?"<>|]/g, '_').replace(/^\.+/, '').trim();
    return { ...data, name: (name.slice(0, -4).slice(0, 96) || 'book') + '.pdf' };
  }
  if (data.type === 'flownote.pdf-export.chunk' && keys === 'base64,id,index,type' && Number.isSafeInteger(data.index) && data.index >= 0
    && typeof data.base64 === 'string' && data.base64.length <= Math.ceil(PDF_CHUNK_BYTES / 3) * 4
    && data.base64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(data.base64)) return data;
  if (['flownote.pdf-export.finish', 'flownote.pdf-export.cancel'].includes(data.type) && keys === 'id,type') return data;
  throw new Error('Invalid PDF export schema');
};

export const isPdfExportMessage = (raw: string) => {
  if (raw.length > maxMessage) return false;
  try { return String(JSON.parse(raw)?.type).startsWith('flownote.pdf-export.'); } catch { return false; }
};
export const pdfStatusScript = (status: PdfExportStatus) => `window.dispatchEvent(new CustomEvent('flownote:pdf-export-status',{detail:${JSON.stringify(status)}}));true;`;

export function createPdfExportReceiver(deps: Dependencies) {
  type Transfer = { request: Start; sink: Sink; index: number; written: number; sharing: boolean; cancelled: boolean };
  let active: Transfer | undefined;
  let pending: { id: string; epoch: number } | undefined;
  let epoch = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = () => { if (timer) clearTimeout(timer); timer = undefined; };
  const remove = (transfer: Transfer) => {
    try { transfer.sink.close(); } catch { /* Cleanup must not interrupt cancellation. */ }
    try { transfer.sink.remove(); } catch { /* OS cache eviction also removes these temporary exports. */ }
  };
  const cancel = () => {
    epoch++; clearTimer();
    if (pending) { deps.notify({ id: pending.id, state: 'cancelled' }); pending = undefined; }
    if (!active) return;
    const transfer = active;
    transfer.cancelled = true;
    deps.notify({ id: transfer.request.id, state: 'cancelled' });
    if (!transfer.sharing) { active = undefined; remove(transfer); }
  };
  const armTimer = () => {
    clearTimer(); timer = setTimeout(() => { cancel(); }, 60000);
  };
  return {
    get busy() { return Boolean(active || pending); },
    cancel,
    async receive(raw: string, source: string, origin: string): Promise<void> {
      const message = parse(raw, source, origin);
      if (message.type === 'flownote.pdf-export.start') {
        if (active || pending) throw new Error('Another export is active');
        const currentEpoch = ++epoch;
        pending = { id: message.id, epoch: currentEpoch };
        try {
          const approved = await deps.confirm(message.name, message.bytes);
          if (pending?.epoch !== currentEpoch) return;
          pending = undefined;
          if (!approved) { deps.notify({ id: message.id, state: 'cancelled' }); return; }
          active = { request: message, sink: deps.open(message.name, message.id), index: 0, written: 0, sharing: false, cancelled: false };
          armTimer(); deps.notify({ id: message.id, state: 'ready' });
        } catch (error) {
          pending = undefined; deps.notify({ id: message.id, state: 'error' }); throw error;
        }
        return;
      }
      if (message.type === 'flownote.pdf-export.cancel') { if (active?.request.id === message.id || pending?.id === message.id) cancel(); return; }
      const transfer = active;
      if (!transfer || transfer.request.id !== message.id || transfer.sharing) throw new Error('Inactive PDF export');
      try {
        if (message.type === 'flownote.pdf-export.chunk') {
          if (message.index !== transfer.index) throw new Error('Unexpected PDF chunk');
          const binary = atob(message.base64), bytes = new Uint8Array(binary.length);
          const expected = Math.min(PDF_CHUNK_BYTES, transfer.request.bytes - transfer.written);
          if (!expected || bytes.length !== expected) throw new Error('PDF chunk size mismatch');
          for (let index = 0; index < bytes.length; index++) bytes[index] = binary.charCodeAt(index);
          if (transfer.written === 0 && String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('Invalid PDF header');
          transfer.sink.append(bytes); transfer.written += bytes.length; transfer.index++;
          armTimer(); deps.notify({ id: message.id, state: 'chunk', index: message.index });
        } else {
          if (transfer.written !== transfer.request.bytes) throw new Error('Incomplete PDF');
          clearTimer(); transfer.sharing = true; transfer.sink.close();
          try {
            await deps.share(transfer.sink.uri, transfer.request.name);
            if (!transfer.cancelled) deps.notify({ id: message.id, state: 'complete' });
          } finally { active = undefined; transfer.sink.remove(); }
        }
      } catch (error) {
        if (active === transfer) { active = undefined; clearTimer(); remove(transfer); }
        deps.notify({ id: message.id, state: 'error' }); throw error;
      }
    },
  };
}
