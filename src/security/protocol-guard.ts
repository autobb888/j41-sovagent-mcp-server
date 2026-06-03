// Local copy of the J41 protocol-shape guard (also in SDK signing/messages.ts
// at version 2.4.0+, but the MCP server vendors it here so the defense doesn't
// silently disappear when the bundled SDK is downgraded or its guard regex
// changes upstream).
//
// Audit 2026-06-02 C1/C3: every signed bytes sequence that the MCP hands to
// the WIF must be either (a) bytes the SDK itself produced (typed builder
// output) or (b) verified by the calling tool to not be a `J41-*|...` shape
// the platform can repurpose. This guard rejects (b)'s failure mode.

const J41_PROTOCOL_PREFIX = /^J41-[A-Za-z0-9-]*\|/;
const VERUS_MAGIC_PREFIX = 'Verus signed data:';

export function assertNotProtocolMessage(text: string): void {
  if (typeof text !== 'string') {
    throw new Error('Refusing to sign non-string input');
  }
  if (J41_PROTOCOL_PREFIX.test(text)) {
    throw new Error(
      'Refusing to sign a J41-protocol-formatted message via the generic signing primitive. ' +
      'Use a typed tool that builds the canonical message locally, or route via signWithAgentBuilt ' +
      'with an audited shape check.',
    );
  }
  if (text.startsWith(VERUS_MAGIC_PREFIX)) {
    throw new Error(
      'Refusing to sign a Verus-magic-prefixed message — caller is asking for a raw signed-data blob',
    );
  }
}
