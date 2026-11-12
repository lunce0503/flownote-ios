const WEB_ORIGINS = ['https://flownote-react.vercel.app', 'https://flownote-react-staging.vercel.app'];
export const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
export const MAX_EXPORT_FILENAME_BYTES = 255;
const MAX_MESSAGE_LENGTH = Math.ceil(MAX_EXPORT_BYTES / 3) * 4 + 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  'text/markdown': '.md', 'text/plain': '.txt', 'text/calendar': '.ics', 'application/json': '.json',
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg',
};
// Runtime copies cannot import the Vite package. The contract test keeps this allowlist equal to
// flownote/src/entities/blog/model/codeFiles.ts, which remains the owning language registry.
export const CODE_EXPORT_EXTENSIONS = Object.freeze([
  'txt', 'text', 'log', 'csv', 'json', 'jsonc', 'py', 'pyi', 'pyw', 'rs', 'ts', 'mts', 'cts', 'tsx',
  'js', 'mjs', 'cjs', 'jsx', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx',
  'cs', 'go', 'swift', 'rb', 'rake', 'php', 'sh', 'bash', 'zsh', 'sql', 'yaml', 'yml', 'toml', 'ini',
  'conf', 'html', 'htm', 'css', 'scss', 'less', 'xml', 'svg', 'md', 'markdown',
] as const);
const CODE_EXPORT_EXTENSION_SET = new Set<string>(CODE_EXPORT_EXTENSIONS);

const utf8Bytes = (value: string) => {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
};

const truncateStem = (stem: string, budget: number) => {
  let result = '';
  let bytes = 0;
  for (const character of stem) {
    const size = utf8Bytes(character);
    if (bytes + size > budget) break;
    result += character; bytes += size;
  }
  return result;
};

export function resolveWebOrigin(value: string | undefined): string {
  if (!value || !WEB_ORIGINS.includes(value)) throw new Error('EXPO_PUBLIC_WEB_URL must select a Flownote cloud web origin.');
  return value;
}

export function navigationAction(raw: string, origin: string): 'internal' | 'external' | 'block' {
  if (raw.length > 4096 || /[\u0000-\u0020\u007f]/.test(raw)) return 'block';
  try {
    const url = new URL(raw);
    if (url.username || url.password) return 'block';
    if (url.protocol === 'https:') return url.origin === origin ? 'internal' : 'external';
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') return 'external';
  } catch { /* A malformed URL never reaches the OS. */ }
  return 'block';
}

export type WebExport = { name: string; mime: string; base64: string };
export function parseExport(raw: string, source: string, origin: string): WebExport {
  if (navigationAction(source, origin) !== 'internal' || raw.length > MAX_MESSAGE_LENGTH) throw new Error('Untrusted export.');
  const data = JSON.parse(raw);
  if (!data || Array.isArray(data) || Object.keys(data).sort().join(',') !== 'base64,mime,name,type'
    || data.type !== 'flownote.export' || typeof data.name !== 'string' || data.name.length > 512
    || typeof data.mime !== 'string' || typeof data.base64 !== 'string') throw new Error('Invalid export.');
  const extension = Object.hasOwn(MIME_EXTENSIONS, data.mime) ? MIME_EXTENSIONS[data.mime] : undefined;
  if (!extension || data.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64)) throw new Error('Unsupported export.');
  const bytes = data.base64.length / 4 * 3 - (data.base64.endsWith('==') ? 2 : data.base64.endsWith('=') ? 1 : 0);
  if (bytes > MAX_EXPORT_BYTES) throw new Error('Export is too large.');
  let name = data.name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069:*?"<>|]/g, '_').replace(/^\.+/, '').trim() || 'flownote';
  const suppliedExtension = name.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  const keepsCodeExtension = data.mime === 'text/plain' && suppliedExtension !== undefined
    && CODE_EXPORT_EXTENSION_SET.has(suppliedExtension);
  if (!keepsCodeExtension && !name.toLowerCase().endsWith(extension)) name += extension;
  const suffixMatch = name.match(/\.[^.]+$/);
  const suffix = suffixMatch?.[0] ?? extension;
  if (utf8Bytes(name) > MAX_EXPORT_FILENAME_BYTES) {
    const stem = name.slice(0, -suffix.length);
    name = `${truncateStem(stem, MAX_EXPORT_FILENAME_BYTES - utf8Bytes(suffix)) || 'flownote'}${suffix}`;
  }
  return { name, mime: data.mime, base64: data.base64 };
}
