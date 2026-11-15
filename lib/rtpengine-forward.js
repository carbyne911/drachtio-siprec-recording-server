const dgram = require('dgram');

function answerForLocalPort(offerSdp, port) {
  const lines = String(offerSdp).split(/\r?\n/);
  const rewritten = lines.map((line) => {
    if (line.indexOf('c=') === 0) {
      return 'c=IN IP4 127.0.0.1';
    }
    if (line.indexOf('m=audio ') === 0) {
      const parts = line.split(' ');
      parts[1] = String(port);
      return parts.join(' ');
    }
    if (line === 'a=sendonly') {
      return 'a=recvonly';
    }
    if (line.indexOf('a=rtcp:') === 0) {
      return `a=rtcp:${Number(port) + 1}`;
    }
    return line;
  });
  const body = rewritten.filter((line, index) => {
    return line !== '' || index !== rewritten.length - 1;
  }).join('\r\n');
  return `${body}\r\n`;
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const fail = (err) => {
      socket.close();
      reject(err);
    };
    socket.once('error', fail);
    socket.bind(0, '127.0.0.1', () => {
      const reserved = socket.address().port;
      socket.close(() => {
        resolve(reserved);
      });
    });
  });
}

function subscribeSide(rtpEngine, callId, fromTag, port) {
  return rtpEngine.subscribeRequest(rtpEngine.remote, {
    'call-id': callId,
    'from-tag': fromTag
  }).then((response) => {
    if (!response || response.result !== 'ok' || !response.sdp || !response['to-tag']) {
      throw new Error(`subscribe request failed: ${JSON.stringify(response)}`);
    }
    return rtpEngine.subscribeAnswer(rtpEngine.remote, {
      'call-id': callId,
      'to-tag': response['to-tag'],
      sdp: answerForLocalPort(response.sdp, port)
    });
  }).then((response) => {
    if (!response || response.result !== 'ok') {
      throw new Error(`subscribe answer failed: ${JSON.stringify(response)}`);
    }
    return port;
  });
}

function holdForMfs(rtpEngine, opts) {
  const callId = opts.callDetails['call-id'];
  let callerPort;
  let calleePort;
  return reservePort()
    .then((port) => {
      callerPort = port;
      return reservePort();
    })
    .then((port) => {
      calleePort = port;
      return subscribeSide(rtpEngine, callId, opts.callDetails['from-tag'], callerPort);
    })
    .then(() => {
      return subscribeSide(rtpEngine, callId, opts.calleeToTag, calleePort);
    })
    .then(() => {
      opts.forwardPorts = {caller: callerPort, callee: calleePort};
      opts.rtpengineHeld = true;
      opts.logger.info('[CARBYNE][RTPENGINE] holding allocation, forwarding to MFS ' +
        `caller=${callerPort} callee=${calleePort} callID=${opts.callid}`);
      return opts;
    })
    .catch((err) => {
      opts.forwardPorts = null;
      opts.rtpengineHeld = false;
      opts.logger.error(`[CARBYNE][RTPENGINE] subscribe failed (${err}); releasing ports for MFS`);
      return rtpEngine.delete(rtpEngine.remote, opts.callDetails).then(() => opts, () => opts);
    });
}

module.exports = {
  answerForLocalPort,
  reservePort,
  subscribeSide,
  holdForMfs
};
