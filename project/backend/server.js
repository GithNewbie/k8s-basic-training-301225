const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    if (req.url === '/api/data') {
        res.end(JSON.stringify({ message: "Hello from Node.js Backend!" }));
    } else {
        res.end(JSON.stringify({ message: "Backend is running" }));
    }
});
server.listen(3000, () => {
    console.log('Backend running on port 3000');
});