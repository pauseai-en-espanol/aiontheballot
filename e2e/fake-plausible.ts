// A stand-in for Plausible in e2e runs: a site script and the events API. The script keeps the real one's contract:
// its site's domain is built in, it sends to the `endpoint` given to plausible.init() as text/plain JSON, and
// it marks itself loaded. The events API records every event with the headers Plausible reads and serves them back
// on GET /received, so tests can check exactly what would have reached Plausible. Run directly by Node (type
// stripping), so it imports nothing from the project.
import { createServer } from 'node:http';

interface Received {
  userAgent: string | undefined;
  forwardedFor: string | undefined;
  contentType: string | undefined;
  cookie: string | undefined;
  body: string;
}

const received: Received[] = [];

/** The seeds' tenant ejemplo-a, as its Plausible site would be named. */
const SCRIPT = `(function () {
  var o = (window.plausible && window.plausible.o) || {};
  fetch(o.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    keepalive: true,
    body: JSON.stringify({ n: 'pageview', v: 0, u: location.href, d: 'ejemplo-a.localhost', r: document.referrer || null }),
  });
  window.plausible.l = true;
})();`;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fake-plausible');
  if (request.method === 'GET' && url.pathname === '/healthz') {
    response.end('ok');
    return;
  }
  if (request.method === 'GET' && url.pathname === '/received') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(received));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/js/pa-e2e.js') {
    response.setHeader('content-type', 'application/javascript');
    // A real response may set headers the site must not pass on.
    response.setHeader('set-cookie', 'fake=1');
    response.end(SCRIPT);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/event') {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        userAgent: request.headers['user-agent'],
        forwardedFor: request.headers['x-forwarded-for'] as string | undefined,
        contentType: request.headers['content-type'],
        cookie: request.headers.cookie,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.statusCode = 202;
      response.end('{}');
    });
    return;
  }
  response.statusCode = 404;
  response.end();
});

server.listen(Number(process.env.PORT), '127.0.0.1');
