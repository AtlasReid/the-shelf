import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFLINE_ASSETS } from './offline-assets.js';

const root = fileURLToPath(new URL('./', import.meta.url));
const port = Number(process.env.PORT || 4318);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const segments = (process.env.BASE_PATH || '').split('/').filter(Boolean);
if (segments.some(segment => ['.', '..'].includes(segment) || segment.includes('\\'))) throw new Error('BASE_PATH must be a URL path such as /the-shelf/.');
const basePath = segments.length ? `/${segments.join('/')}/` : '/';
const runtimeOnly = process.env.RUNTIME_ONLY === '1';
// A phone preview shares only the app and preserved compatibility view. Never
// expose the repository directory, test scripts, logs or preparation metadata.
const runtimePaths = new Set([
  ...OFFLINE_ASSETS.map(asset => asset.replace(/^\.\//,'')),
  'compatibility/index.html','compatibility/compatibility.css','compatibility/compatibility.js',
]);
const types = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.svg':'image/svg+xml',
  '.woff2':'font/woff2',
  '.txt':'text/plain; charset=utf-8',
  '.md':'text/plain; charset=utf-8',
};

const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, {'Allow':'GET, HEAD'});
    response.end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (basePath !== '/' && (pathname === '/' || pathname === basePath.slice(0, -1))) {
      response.writeHead(302, {'Location':basePath});
      response.end();
      return;
    }
    if (!pathname.startsWith(basePath)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    let relative = pathname.slice(basePath.length);
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    if (runtimeOnly && !runtimePaths.has(relative)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const target = path.resolve(root, relative);
    const relation = path.relative(root, target);
    if (relation.startsWith('..') || path.isAbsolute(relation) || relative.split(/[\\/]/).some(part => part.startsWith('.'))) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    if (!(await stat(target)).isFile()) throw new Error('Not a file');
    const data = await readFile(target);
    response.writeHead(200, {
      'Content-Type':types[path.extname(target)] || 'application/octet-stream',
      'Content-Length':data.length,
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
      'X-Shelf-Preview':runtimeOnly ? 'runtime-only' : 'development',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}${basePath}`));
