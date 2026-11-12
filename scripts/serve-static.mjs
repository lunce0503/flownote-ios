import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const isFile = async (path) => {
  try {
    await access(path);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

const resolveRequestFile = async (root, pathname) => {
  const normalizedRoot = resolve(root);
  const relativePath = pathname.replace(/^\/+/, '');
  const candidate = resolve(normalizedRoot, relativePath);
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) {
    return null;
  }

  const candidates = extname(candidate)
    ? [candidate]
    : [candidate, `${candidate}.html`, join(candidate, 'index.html')];

  for (const path of candidates) {
    if (await isFile(path)) return path;
  }

  return join(normalizedRoot, 'index.html');
};

export const createStaticServer = (root = resolve('dist')) =>
  createServer(async (request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'UP', service: 'flownote-mobile' }));
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }

    const rawPathname = (request.url ?? '/').split('?')[0];
    let pathname;
    try {
      pathname = decodeURIComponent(rawPathname);
    } catch {
      response.writeHead(400);
      response.end('Bad Request');
      return;
    }

    if (pathname.split('/').includes('..')) {
      response.writeHead(400);
      response.end('Bad Request');
      return;
    }

    const file = await resolveRequestFile(root, pathname);
    if (!file || !(await isFile(file))) {
      response.writeHead(404);
      response.end('Not Found');
      return;
    }

    const cacheControl = pathname.startsWith('/_expo/static/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    response.writeHead(200, {
      'Cache-Control': cacheControl,
      'Content-Type': MIME_TYPES[extname(file)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(file).pipe(response);
  });

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  const server = createStaticServer();
  server.listen(port, host, () => {
    process.stdout.write(`flownote-mobile listening on http://${host}:${port}\n`);
  });
}
