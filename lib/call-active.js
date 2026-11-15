const http = require('http');
const Client = require('rtpengine-client').Client;

function hasPort(body, port) {
  const tags = (body && body.tags) || {};
  return Object.keys(tags).some((tag) => {
    return (tags[tag].medias || []).some((media) => {
      return (media.streams || []).some((stream) => Number(stream['local port']) === port);
    });
  });
}

function allocatedOn(client, remote, port, ids, index) {
  if (index >= ids.length) {
    return Promise.resolve(false);
  }
  return client.query(remote, {'call-id': ids[index]}).then((body) => {
    if (hasPort(body, port)) {
      return true;
    }
    return allocatedOn(client, remote, port, ids, index + 1);
  }, () => allocatedOn(client, remote, port, ids, index + 1));
}

function portIsAllocated(client, remote, port) {
  return client.list(remote, {limit: 4096}).then((listed) => {
    return allocatedOn(client, remote, port, (listed && listed.calls) || [], 0);
  }, () => false);
}

function listen(rtpengineConfig, port, logger) {
  const client = new Client({timeout: 1500});
  const remote = (Array.isArray(rtpengineConfig) ? rtpengineConfig[0] : rtpengineConfig).remote;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url.split('?')[0] !== '/active') {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let rtpPort = 0;
      try {
        rtpPort = Number(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}').port);
      } catch (err) {
        res.writeHead(400);
        res.end();
        return;
      }
      if (!rtpPort) {
        res.writeHead(400);
        res.end();
        return;
      }
      return portIsAllocated(client, remote, rtpPort).then((active) => {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({active: active}));
        return null;
      }, () => {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({active: false}));
        return null;
      });
    });
  });
  server.listen(port, '127.0.0.1', () => {
    logger.info(`[CARBYNE][RTPENGINE] call-active listening on 127.0.0.1:${port}`);
  });
  return server;
}

module.exports = {
  hasPort,
  portIsAllocated,
  listen
};
