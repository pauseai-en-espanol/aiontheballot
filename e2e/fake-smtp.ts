// A stand-in for the platform's SMTP sender in e2e runs: just enough SMTP for nodemailer to hand over a
// message (no TLS, no authentication), and an HTTP side that serves back every message received on GET /received, so
// tests can read what would have been sent. Run directly by Node (type stripping), so it imports nothing from the
// project.
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';

interface Received {
  from: string;
  to: string[];
  /** The message as sent: headers, a blank line, the body (dot-stuffing undone). */
  data: string;
}

const received: Received[] = [];

const smtp = createServer((socket) => {
  socket.setEncoding('utf8');
  let buffer = '';
  let envelope: { from: string; to: string[] } = { from: '', to: [] };
  let data: string[] | undefined;
  const say = (line: string) => socket.write(`${line}\r\n`);
  say('220 fake-smtp ESMTP');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let end = buffer.indexOf('\r\n');
    while (end >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf('\r\n');
      if (data) {
        if (line === '.') {
          received.push({ ...envelope, data: data.join('\r\n') });
          envelope = { from: '', to: [] };
          data = undefined;
          say('250 OK: queued');
        } else {
          data.push(line.startsWith('..') ? line.slice(1) : line);
        }
        continue;
      }
      const command = line.slice(0, 4).toUpperCase();
      if (command === 'EHLO') {
        socket.write('250-fake-smtp\r\n250 8BITMIME\r\n');
      } else if (command === 'HELO' || command === 'NOOP') {
        say('250 OK');
      } else if (command === 'MAIL') {
        envelope = { from: /<([^>]*)>/.exec(line)?.[1] ?? '', to: [] };
        say('250 OK');
      } else if (command === 'RCPT') {
        envelope.to.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
        say('250 OK');
      } else if (command === 'DATA') {
        data = [];
        say('354 End data with <CR><LF>.<CR><LF>');
      } else if (command === 'RSET') {
        envelope = { from: '', to: [] };
        say('250 OK');
      } else if (command === 'QUIT') {
        say('221 Bye');
        socket.end();
      } else {
        say('502 Command not implemented');
      }
    }
  });
  socket.on('error', () => undefined);
});

const http = createHttpServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fake-smtp');
  if (url.pathname === '/healthz') {
    response.end('ok');
  } else if (url.pathname === '/received') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(received));
  } else {
    response.statusCode = 404;
    response.end();
  }
});

smtp.listen(Number(process.env.SMTP_PORT), '127.0.0.1');
http.listen(Number(process.env.PORT), '127.0.0.1');
