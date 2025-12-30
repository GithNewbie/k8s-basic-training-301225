const http = require('http');
const { URL } = require('url');

const BACKEND1_URL = 'http://project-backend-service/api/data'; // gọi service BE1 trong cluster

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (req.url === '/api/data') {
    // gọi BE1 và trả về kết hợp
    http.get(BACKEND1_URL, (backendRes) => {
      let body = '';
      backendRes.on('data', (chunk) => body += chunk);
      backendRes.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        try {
          const b = JSON.parse(body);
          res.end(JSON.stringify({ from: "backend-v2", upstream: b }));
        } catch (e) {
          res.end(JSON.stringify({ from: "backend-v2", upstream: body }));
        }
      });
    }).on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream error', detail: String(err) }));
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'backend-v2 running' }));
});

const port = process.env.PORT || 3001;
server.listen(port, () => console.log(`backend-v2 running on ${port}`));