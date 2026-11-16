const test = require('tape').test;
const {isActive} = require('../lib/call-query');

test('query result ok means the call is still allocated', (t) => {
  t.equal(isActive({result: 'ok'}), true);
  t.equal(isActive({result: 'error'}), false);
  t.equal(isActive(null), false);
  t.end();
});
