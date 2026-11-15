const test = require('tape').test;
const {answerForLocalPort} = require('../lib/rtpengine-forward');
const {queryHasPort, portIsAllocated} = require('../lib/call-active');

const OFFER = [
  'v=0',
  'o=- 0 0 IN IP4 10.0.0.8',
  's=-',
  'c=IN IP4 10.0.0.8',
  't=0 0',
  'm=audio 30018 RTP/AVP 8 101',
  'a=rtpmap:8 PCMA/8000',
  'a=sendonly',
  'a=rtcp:30019'
].join('\r\n') + '\r\n';

test('subscribe answer points the allocation at the MFS port', (t) => {
  const answer = answerForLocalPort(OFFER, 41000);
  t.ok(answer.indexOf('c=IN IP4 127.0.0.1') >= 0);
  t.ok(answer.indexOf('m=audio 41000 RTP/AVP 8 101') >= 0);
  t.ok(answer.indexOf('a=recvonly') >= 0);
  t.ok(answer.indexOf('a=rtcp:41001') >= 0);
  t.equal(answer.indexOf('c=IN IP4 10.0.0.8'), -1);
  t.equal(answer.indexOf('a=sendonly'), -1);
  t.end();
});

test('a port is active only when rtpengine still lists it', (t) => {
  const live = {
    tags: {
      from: {
        medias: [{
          streams: [{
            'local port': 30018,
            endpoint: {address: '127.0.0.1', port: 41000}
          }]
        }]
      }
    }
  };
  t.equal(queryHasPort(live, 41000), true);
  t.equal(queryHasPort(live, 30018), true);
  t.equal(queryHasPort(live, 41001), false);
  t.equal(queryHasPort({}, 41000), false);
  t.end();
});

test('lookup uses the rtpengine response and does not keep a call map', (t) => {
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
            medias: [{streams: [{endpoint: {port: 41000}}]}]
          }
        }
      });
    }
  };
  portIsAllocated([engine], 41000, '').then((active) => {
    t.equal(active, true);
    return portIsAllocated([engine], 41000, 'gone');
  }).then((active) => {
    t.equal(active, false);
    t.equal(engine.calls, undefined);
    t.end();
    return null;
  }).catch((err) => {
    t.end(err);
  });
});
