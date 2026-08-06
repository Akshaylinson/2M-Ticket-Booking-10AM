import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 5173);
const BACKEND_BASE = process.env.BACKEND_BASE_URL || 'http://127.0.0.1:8000';
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function serveFile(res, filePath) {
  try {
    const data = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

async function proxyApi(req, res, url) {
  const target = `${BACKEND_BASE}${url.pathname.replace(/^\/api/, '')}${url.search}`;
  const headers = { ...req.headers };
  delete headers.host;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const upstream = await fetch(target, { method: req.method, headers, body });
  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  res.writeHead(upstream.status, responseHeaders);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const arrayBuffer = await upstream.arrayBuffer();
  res.end(Buffer.from(arrayBuffer));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      await proxyApi(req, res, url);
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Proxy error' }));
    }
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    await serveFile(res, join(ROOT, 'index.html'));
    return;
  }
  if (url.pathname === '/spike' || url.pathname === '/spike.html') {
    await serveFile(res, join(ROOT, 'spike.html'));
    return;
  }
  if (url.pathname === '/app.js') {
    await serveFile(res, join(ROOT, 'app.js'));
    return;
  }
  if (url.pathname === '/spike.js') {
    await serveFile(res, join(ROOT, 'spike.js'));
    return;
  }
  if (url.pathname === '/styles.css') {
    await serveFile(res, join(ROOT, 'styles.css'));
    return;
  }
  if (url.pathname === '/spike.css') {
    await serveFile(res, join(ROOT, 'spike.css'));
    return;
  }
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Frontend server running at http://127.0.0.1:${PORT}`);
});