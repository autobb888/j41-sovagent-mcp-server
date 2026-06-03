// Local copy of the J41 protocol-shape guard. Vendored here so the defense
// doesn't silently disappear when the bundled SDK is downgraded or its guard
// regex changes upstream.
//
// Audit 2026-06-02 C1/C3 + 3243a8f / fcc68db (parallel hardening): every signed
// bytes sequence that the MCP hands to the WIF must be either (a) bytes the SDK
// itself produced (typed builder output) or (b) verified by the calling tool to
// not be a `J41-*|...` shape the platform can repurpose. This guard rejects (b)'s
// failure mode AND smuggle-via-normalization attacks.

// Zero-width / BOM / line-separator / format characters: reject outright.
const FORMAT_CHARS = /[\u200B-\u200F\u2028\u2029\u2060\uFEFF]/;

// J41-<ACTION>|... protocol-shape prefix (case-insensitive). Trailing pipe is
// the structural marker; opaque challenges have no pipe and are allowed.
const J41_PROTOCOL_PREFIX = /^j41-[a-z0-9-]*\|/i;
const VERUS_MAGIC_PREFIX = 'Verus signed data:';

// Unicode dashes/hyphens that NFKC doesn't fold to ASCII '-'.
const UNICODE_DASH_RANGE = /[\u2010-\u2015\u2212]/g;

export function assertNotProtocolMessage(text: string): void {
  if (typeof text !== 'string') {
    throw new Error('Refusing to sign non-string input');
  }
  if (FORMAT_CHARS.test(text)) {
    throw new Error('Refusing to sign a message containing zero-width or format characters.');
  }
  const head = text
    .normalize('NFKC')
    .replace(UNICODE_DASH_RANGE, '-')
    .replace(/^\s+/, '');
  if (J41_PROTOCOL_PREFIX.test(head)) {
    throw new Error(
      'Refusing to sign a J41-protocol-formatted message via the generic signing primitive. ' +
      'Use a typed tool that builds the canonical message locally, or route via signWithAgentBuilt ' +
      'with an audited shape check.',
    );
  }
  if (head.startsWith(VERUS_MAGIC_PREFIX)) {
    throw new Error(
      'Refusing to sign a Verus-magic-prefixed message — caller is asking for a raw signed-data blob.',
    );
  }
}
