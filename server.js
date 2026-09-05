const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const STATIC_DIR = __dirname;
const PROXY_WINDOW_MS = 60_000;
const PROXY_REQUEST_LIMIT = 30;
const PROXY_BODY_LIMIT = 8 * 1024 * 1024;
const PROXY_ROUTES = new Set([
  '/chat/completions',
  '/audio/speech',
  '/audio/transcriptions'
]);
const proxyClients = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function readBody(req, limit = PROXY_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;

    const fail = error => {
      if (finished) return;
      finished = true;
      reject(error);
    };

    req.on('data', chunk => {
      if (finished) return;
      size += chunk.length;
      if (size > limit) {
        const error = new Error('Request body is too large.');
        error.code = 'BODY_TOO_LARGE';
        fail(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (finished) return;
      finished = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', fail);
  });
}

function clientAddress(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function allowProxyRequest(req) {
  const key = clientAddress(req);
  const now = Date.now();
  const current = proxyClients.get(key);

  if (!current || current.resetAt <= now) {
    proxyClients.set(key, { count: 1, resetAt: now + PROXY_WINDOW_MS });
    return true;
  }

  current.count += 1;
  return current.count <= PROXY_REQUEST_LIMIT;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && sameOrigin(req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

async function proxyGroq(req, res, urlPath) {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    sendJson(res, 503, { error: 'AI service is temporarily unavailable.' });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
    return;
  }

  if (!sameOrigin(req)) {
    sendJson(res, 403, { error: 'Cross-origin AI proxy requests are not allowed.' });
    return;
  }

  if (!allowProxyRequest(req)) {
    sendJson(
      res,
      429,
      { error: 'Too many AI requests. Please wait and try again.' },
      { 'Retry-After': '60' }
    );
    return;
  }

  const upstreamPath = urlPath.replace(/^\/api\/openai\/v1/, '');
  if (!PROXY_ROUTES.has(upstreamPath)) {
    sendJson(res, 404, { error: 'AI proxy route is not available.' });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    if (error && error.code === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { error: 'Request body is too large.' });
      return;
    }
    sendJson(res, 400, { error: 'Unable to read request body.' });
    return;
  }

  const target = `https://api.groq.com/openai/v1${upstreamPath}`;
  const headers = {
    Authorization: `Bearer ${key}`
  };

  const contentType = req.headers['content-type'];
  if (contentType) headers['Content-Type'] = contentType;

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(buf);
  } catch {
    sendJson(res, 502, { error: 'AI provider request failed.' });
  }
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'Cross-origin requests are not allowed.' });
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  let urlPath = req.url.split('?')[0];

  if (urlPath === '/api/health') {
    sendJson(res, 200, {
      status: 'ok',
      service: 'bobs-sleep-tracker'
    });
    return;
  }

  if (urlPath.startsWith('/api/openai/v1/')) {
    await proxyGroq(req, res, urlPath);
    return;
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(STATIC_DIR, safePath);

  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(STATIC_DIR, 'index.html'), (err2, indexData) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(indexData);
        }
      });
      return;
    }

    const cacheControl = ext === '.html'
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=31536000, immutable';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`BOB's Sleep Tracker running on port ${PORT}`);
});
