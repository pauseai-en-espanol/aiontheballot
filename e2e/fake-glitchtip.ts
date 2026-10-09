// A stand-in for GlitchTip's ingest endpoint in e2e runs. It records every envelope it is sent and serves them back
// on GET /received, so tests can check exactly what would have reached GlitchTip. Run directly by Node (type
// stripping), so it imports nothing from the project.
import { createServer } from 'node:http';

interface Received {
  path: string;
  query: string;
  body: string;
}

const received: Received[] = [];

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fake-glitchtip');
  if (request.method === 'GET' && url.pathname === '/healthz') {
    response.end('ok');
    return;
  }
  if (request.method === 'GET' && url.pathname === '/received') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(received));
    return;
  }
  if (request.method === 'POST' && /^\/api\/\d+\/envelope\/$/.test(url.pathname)) {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        path: url.pathname,
        query: url.search,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.setHeader('content-type', 'application/json');
      // A real ingest may set headers the relay must not pass on.
      response.setHeader('set-cookie', 'fake=1');
      response.end('{"id":"e2e"}');
    });
    return;
  }
  response.statusCode = 404;
  response.end();
});

server.listen(Number(process.env.PORT), '127.0.0.1');
