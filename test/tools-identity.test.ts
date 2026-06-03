import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeypair, signMessage, signChallenge } from '@junction41/sovagent-sdk';
// Audit-merge 43ed4e9: the guard moved out of tools/identity.ts (whose
// j41_sign_message + j41_sign_challenge tools were removed entirely per
// C1/C3) into the vendored src/security/protocol-guard.ts so the defense
// doesn't disappear if the bundled SDK is downgraded.
import { assertNotProtocolMessage } from '../build/security/protocol-guard.js';

describe('Identity tools (pure functions)', () => {
  it('should generate a valid keypair for verustest', () => {
    const kp = generateKeypair('verustest');
    assert.ok(kp.wif, 'should have wif');
    assert.ok(kp.pubkey, 'should have pubkey');
    assert.ok(kp.address, 'should have address');
    assert.equal(kp.pubkey.length, 66, 'compressed pubkey is 33 bytes = 66 hex chars');
    assert.ok(kp.address.startsWith('R'), 'address should start with R');
  });

  it('should generate a valid keypair for verus mainnet', () => {
    const kp = generateKeypair('verus');
    assert.ok(kp.wif);
    assert.ok(kp.pubkey);
    assert.ok(kp.address.startsWith('R'));
  });

  it('should generate unique keypairs', () => {
    const kp1 = generateKeypair('verustest');
    const kp2 = generateKeypair('verustest');
    assert.notEqual(kp1.wif, kp2.wif);
    assert.notEqual(kp1.pubkey, kp2.pubkey);
    assert.notEqual(kp1.address, kp2.address);
  });

  it('should sign a message and return a non-empty signature', () => {
    const kp = generateKeypair('verustest');
    const sig = signMessage(kp.wif, 'hello world', 'verustest');
    assert.ok(sig, 'signature should not be empty');
    assert.ok(typeof sig === 'string');
    assert.ok(sig.length > 0);
  });

  it('should produce different signatures for different messages', () => {
    const kp = generateKeypair('verustest');
    const sig1 = signMessage(kp.wif, 'message 1', 'verustest');
    const sig2 = signMessage(kp.wif, 'message 2', 'verustest');
    assert.notEqual(sig1, sig2);
  });

  it('should sign a challenge with an address', () => {
    const kp = generateKeypair('verustest');
    // Use the generated keypair's R-address (valid base58check)
    const sig = signChallenge(kp.wif, 'test-challenge-123', kp.address, 'verustest');
    assert.ok(sig, 'challenge signature should not be empty');
    assert.ok(typeof sig === 'string');
  });
});

describe('Signing oracle guard (MEDIUM-4)', () => {
  it('rejects messages formatted as J41 protocol messages', () => {
    for (const m of [
      'J41-ACCEPT|Job:abc|...',
      'j41-deposit-report|Buyer:x',
      '  J41-ACCESS-ENVELOPE|Cipher:...',
      'J41-STATUS|toggle',
    ]) {
      assert.throws(() => assertNotProtocolMessage(m), /J41-protocol/i, `should reject: ${m}`);
    }
  });

  it('allows ordinary (non-protocol) messages', () => {
    for (const m of ['hello world', 'sign this please', 'login to acme.com nonce=123', 'j 41 spaced']) {
      assert.doesNotThrow(() => assertNotProtocolMessage(m), `should allow: ${m}`);
    }
  });
});
