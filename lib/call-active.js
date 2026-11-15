const http = require('http');
const Client = require('rtpengine-client').Client;

const LIST_LIMIT = 4096;

function queryHasPort(body, port) {
  const wanted = Number(port);
  const tags = body && body.tags;
  if (!tags || !wanted) {
    return false;
  }
  return Object.keys(tags).some((tag) => {
    const medias = tags[tag].medias || [];
    return medias.some((media) => {
      const streams = media.streams || [];
      return streams.some((stream) => {
        if (Number(stream['local port']) === wanted) {
          return true;
        }
        const endpoint = stream.endpoint || {};
        const advertised = stream['advertised endpoint'] || {};
        return Number(endpoint.port) === wanted || Number(advertised.port) === wanted;
      });
    });
  });
}

function queryCall(engine, callId, port) {
  return engine.query({'call-id': callId}).then((body) => {
    return queryHasPort(body, port);
  }, () => false);
}

function scanCalls(engine, ids, port, index) {
  if (index >= ids.length) {
    return Promise.resolve(false);
  }
  return queryCall(engine, ids[index], port).then((found) => {
    if (found) {
      return true;
    }
    return scanCalls(engine, ids, port, index + 1);
  });
}

function portIsAllocated(engines, port, callId) {
  const checks = engines.map((engine) => {
    if (callId) {
      return queryCall(engine, callId, port);
    }
    return engine.list({limit: LIST_LIMIT}).then((listed) => {
      const ids = (listed && listed.calls) || [];
      return scanCalls(engine, ids, port, 0);
    }, () => false);
  });
  return Promise.all(checks).then((results) => results.some(Boolean));
}

function engineAdapter(client, remote) {
  return {
    query(args) {
      return client.query(remote, args);
    },
    list(args) {
      return client.list(remote, args);
    }
  };
}

function remotesOf(rtpengineConfig) {
  const configured = Array.isArray(rtpengineConfig) ? rtpengineConfig : [rtpengineConfig];
  return configured.map((item) => item.remote).filter((remote) => remote && remote.host && remote.port);
}

function sendJson(res, status, body) {
  res.writeHead(status, {'content-type': 'application/json'});
  res.end(JSON.stringify(body));
}

function listen(rtpengineConfig, port, logger) {
  const client = new Client({timeout: 1500});
  const engines = remotesOf(rtpengineConfig).map((remote) => engineAdapter(client, remote));
  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch (err) {
      sendJson(res, 400, {active: false});
      return;
    }
    if (req.method !== 'GET' || url.pathname !== '/active') {
      sendJson(res, 404, {active: false});
      return;
    }
    const rtpPort = Number(url.searchParams.get('port'));
    const callId = url.searchParams.get('call-id') || '';
    if (!rtpPort) {
      sendJson(res, 400, {active: false});
      return;
    }
    return portIsAllocated(engines, rtpPort, callId).then((active) => {
      sendJson(res, 200, {active: active});
      return null;
    }, (err) => {
      logger.error(`[CARBYNE][RTPENGINE] active check failed: ${err}`);
      sendJson(res, 200, {active: false});
      return null;
    });
  });
  server.listen(port, '127.0.0.1', () => {
    logger.info(`[CARBYNE][RTPENGINE] call-active listening on 127.0.0.1:${port}`);
  });
  return server;
}

module.exports = {
  queryHasPort,
  portIsAllocated,
  listen,
  LIST_LIMIT
};
