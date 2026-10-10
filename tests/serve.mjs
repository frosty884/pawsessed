// Local preview: serves the site and runs the real apps-script/Code.gs behind /api/exec on an in-memory sheet.
//   node tests/serve.mjs [port]      then open http://localhost:PORT/?api=http://localhost:PORT/api/exec
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from './mock-gas.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};

export function startServer(port = 0) {
  const gas = createGas();
  gas.ctx.setup();
  // tests can make the next N POSTs fail like a Google outage (an HTML error page instead of JSON)
  const faults = { posts: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/exec') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'POST' && faults.posts > 0) {
        faults.posts--;
        req.resume();
        res.writeHead(500, { 'Content-Type': 'text/html' });
        return res.end('<html><body>Service unavailable</body></html>');
      }
      if (req.method === 'GET') {
        const out = gas.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(out);
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const out = gas.ctx.doPost({ postData: { contents: body } }).getContent();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(out);
        });
        return;
      }
      res.writeHead(405); return res.end();
    }
    let p = path.join(ROOT, decodeURIComponent(url.pathname));
    if (p.endsWith(path.sep) || url.pathname === '/') p = path.join(p, 'index.html');
    if (!p.startsWith(ROOT) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    const size = statSync(p).size;
    const type = MIME[path.extname(p)] || 'application/octet-stream';
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return createReadStream(p, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    createReadStream(p).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, gas, faults, port: server.address().port })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { port } = await startServer(Number(process.argv[2] || 8787));
  console.log(`http://localhost:${port}/?api=http://localhost:${port}/api/exec`);
}
