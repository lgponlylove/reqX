import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFile, execSync } from 'child_process';

const distDir = path.resolve('dist');
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(distDir, reqPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // SPA fallback
    const indexPath = path.join(distDir, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(indexPath).pipe(res);
  }
});

const PORT = 5199;
server.listen(PORT, async () => {
  console.log(`Test server running on port ${PORT}`);
  fs.mkdirSync(path.resolve('docs/assets'), { recursive: true });
  const outImg = path.resolve('docs/assets/test_main.png');
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

  const cmd = `"${edgePath}" --headless --disable-gpu --window-size=1440,900 --screenshot="${outImg}" http://localhost:${PORT}`;
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`Captured test screenshot: ${outImg}, size: ${fs.statSync(outImg).size} bytes`);
  } catch (err) {
    console.error('Capture error:', err);
  } finally {
    server.close();
  }
});
