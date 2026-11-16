const http = require('http');

function isActive(body) {
  return Boolean(body && body.result === 'ok');
}

function listen(rtpEngine, port, logger) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url.split('?')[0] !== '/active') {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let callId = '';
      try {
        callId = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')['call-id'];
      } catch (err) {
        res.writeHead(400);
        res.end();
        return;
      }
      if (!callId) {
        res.writeHead(400);
        res.end();
        return;
      }
      return rtpEngine.query(rtpEngine.remote, {'call-id': callId}).then((body) => {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({active: isActive(body)}));
        return null;
      }, () => {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({active: false}));
        return null;
      });
    });
  });
  server.listen(port, '127.0.0.1', () => {
    logger.info(`[CARBYNE][RTPENGINE] query listening on 127.0.0.1:${port}`);
  });
  return server;
}

module.exports = {
  isActive,
  listen
};
