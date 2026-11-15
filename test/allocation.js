const test = require('tape').test;
const {hasPort, portIsAllocated} = require('../lib/call-active');

test('active means rtpengine still has the local port', (t) => {
  const body = {tags: {from: {medias: [{streams: [{'local port': 30018}]}]}}};
  t.equal(hasPort(body, 30018), true);
  t.equal(hasPort(body, 30019), false);

  const client = {
    list() {
      return Promise.resolve({calls: ['up']});
    },
    query() {
      return Promise.resolve(body);
    }
  };
  portIsAllocated(client, {host: '127.0.0.1', port: 22222}, 30018).then((active) => {
    t.equal(active, true);
    t.end();
    return null;
  }).catch((err) => {
    t.end(err);
  });
});
