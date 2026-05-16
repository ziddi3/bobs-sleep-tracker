const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const STATIC_DIR = __dirname;

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function proxyGroq(req, res, urlPath) {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'GROQ_API_KEY is not configured on the server.'
    }));
    return;
  }

  const upstreamPath = urlPath.replace(/^\/api\/openai\/v1/, '');
  const target = `https://api.groq.com/openai/v1${upstreamPath}`;
  const body = await readBody(req);

  const headers = {
    'Authorization': `Bearer ${key}`
  };

  const contentType = req.headers['content-type'];
  if (contentType) headers['Content-Type'] = contentType;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    const responseHeaders = {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store'
    };

    res.writeHead(upstream.status, responseHeaders);
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Groq proxy request failed.',
      detail: err.message
    }));
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let urlPath = req.url.split('?')[0];

  if (urlPath === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'bobs-sleep-tracker',
      groqConfigured: Boolean(process.env.GROQ_API_KEY)
    }));
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
