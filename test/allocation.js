const test = require('tape').test;
const {queryHasPort, portIsAllocated} = require('../lib/call-active');

test('a port is active only when rtpengine still has it allocated', (t) => {
  const live = {
    tags: {
      from: {
        medias: [{
          streams: [{
            'local port': 30018,
            endpoint: {address: '10.1.1.8', port: 41000}
          }]
        }]
      }
    }
  };
  t.equal(queryHasPort(live, 30018), true);
  t.equal(queryHasPort(live, 41000), false);
  t.equal(queryHasPort({}, 30018), false);
  t.end();
});

test('lookup uses the rtpengine allocation and does not keep a call map', (t) => {
  const calls = ['still-up'];
  const engine = {
    list() {
      return Promise.resolve({calls: calls.slice()});
    },
    query(args) {
      if (args['call-id'] !== 'still-up') {
        return Promise.resolve({result: 'error'});
      }
      return Promise.resolve({
        tags: {
          side: {
            medias: [{streams: [{'local port': 30018}]}]
          }
        }
      });
    }
  };
  portIsAllocated([engine], 30018).then((active) => {
    t.equal(active, true);
    return portIsAllocated([engine], 30019);
  }).then((active) => {
    t.equal(active, false);
    t.equal(engine.calls, undefined);
    t.end();
    return null;
  }).catch((err) => {
    t.end(err);
  });
});
