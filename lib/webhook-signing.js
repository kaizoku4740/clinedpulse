function hexToBytes(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || '')) return null;
  return new Uint8Array(value.match(/.{2}/g).map(byte => Number.parseInt(byte, 16)));
}
function constantTimeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyWebhookSignature({ secret, timestamp, signature, body, now = Date.now() }) {
  if (!secret) return { ok: false, reason: 'not_configured' };
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(now - timestampNumber * 1000) > 5 * 60 * 1000) {
    return { ok: false, reason: 'expired' };
  }
  const supplied = hexToBytes(signature);
  if (!supplied) return { ok: false, reason: 'invalid' };
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`)));
  return { ok: constantTimeEqual(expected, supplied), reason: 'invalid' };
}
