// serve.js — tiny static server for previewing html/templates in a real browser with the
// dev controls (space = play/pause, ←/→ = frame step, Home = rewind).
//   node html/render/serve.js [dir=.] [port=8093]   → http://localhost:8093/html/templates/showreel.html
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 8093);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp4': 'video/mp4' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let p = path.join(root, url);
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  try {
    if (fs.statSync(p).isDirectory()) {
      const items = fs.readdirSync(p).map((f) => '<li><a href="' + path.posix.join(url, f) + '">' + f + '</a></li>').join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<ul>' + items + '</ul>');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  } catch (e) { res.writeHead(404); res.end('not found'); }
}).listen(port, () => console.log('serving ' + root + ' at http://localhost:' + port + '/html/templates/'));
