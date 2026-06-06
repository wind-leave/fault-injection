import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5190);
const distRoot = resolve('dist');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.py': 'text/x-python; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function resolveRequestPath(url) {
  const rawPath = decodeURIComponent(new URL(url, `http://${host}:${port}`).pathname);
  const normalizedPath = normalize(rawPath).replace(/^([/\\])+/, '');
  let filePath = resolve(join(distRoot, normalizedPath));

  if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
    return null;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath)) {
    filePath = join(distRoot, 'index.html');
  }

  return filePath;
}

const server = createServer((req, res) => {
  const filePath = resolveRequestPath(req.url || '/');

  if (!filePath || !existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const contentType = mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`Local dist server running at http://${host}:${port}/`);
});
