import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sha1Of, sha256Of, sha256Stream } from '../../../src/shell/hash.ts';

test('sha1Of matches the FIPS 180 vectors', () => {
  assert.equal(sha1Of(''), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assert.equal(sha1Of('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(sha1Of(new TextEncoder().encode('abc')), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(
    sha1Of('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
  );
});

test('sha256Of matches the FIPS 180 vectors and hashes strings as UTF-8', () => {
  assert.equal(sha256Of(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Of('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Of('é'), sha256Of(new Uint8Array([0xc3, 0xa9])));
});

test('sha256Stream equals the hash of the concatenation', () => {
  assert.equal(sha256Stream(['a', 'b', new TextEncoder().encode('c')]), sha256Of('abc'));
  assert.equal(sha256Stream([]), sha256Of(''));
  function* chunks(): Generator<string> {
    for (let i = 0; i < 1000; i++) yield `${i},`;
  }
  assert.equal(sha256Stream(chunks()), sha256Of([...chunks()].join('')));
});
