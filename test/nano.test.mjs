import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NanoClient, NanoRequestError, NanoPaymentRejectedError, isNanoAsyncJob } from '../dist/index.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const KEY = `0x${'11'.repeat(32)}`;
const GATEWAY_WALLET = '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE';
const PAY_TO = '0xe9030014F5DAe217d0A152f02A043567b16c1aBf';
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64');
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const client = (cfg = {}) => new NanoClient({ chain: 'polygon', privateKey: KEY, maxRetries: 2, ...cfg });

const quote = (overrides = {}) => json({ error: 'Payment Required' }, 402, {
  'PAYMENT-REQUIRED': b64({
    x402Version: 2,
    resource: { url: 'https://nano.blockrun.ai/api/v1/chat/completions' },
    accepts: [
      // Another chain first: the client must pick its own network.
      { scheme: 'exact', network: 'eip155:42161', amount: '1', payTo: PAY_TO, maxTimeoutSeconds: 691200,
        extra: { name: 'GatewayWalletBatched', version: '1', verifyingContract: GATEWAY_WALLET } },
      { scheme: 'exact', network: 'eip155:137', amount: '3000', payTo: PAY_TO, maxTimeoutSeconds: 691200,
        extra: { name: 'GatewayWalletBatched', version: '1', verifyingContract: GATEWAY_WALLET }, ...overrides },
    ],
  }),
});
const settled = (data, status = 200) => json(data, status, { 'PAYMENT-RESPONSE': b64({ success: true, transaction: 'b2c1e7a0-uuid' }) });
const signatureOf = init => new Headers(init.headers).get('payment-signature');

test('free (non-402) response: no signature, no spend', async () => {
  let calls = 0;
  globalThis.fetch = async (_, init) => { calls++; assert.equal(signatureOf(init), null); return json({ choices: [] }); };
  const c = client();
  const r = await c.chat({ model: 'nvidia/gpt-oss-20b', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(calls, 1);
  assert.equal(r.payment.amount, 0n);
  assert.equal(r.payment.transaction, '');
  assert.equal(c.getSpending().calls, 0);
});

test('paid call signs this chain\'s option once, records spend and transfer id', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(init);
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    return seen.length === 1 ? quote() : settled({ choices: [{ message: { content: 'ok' } }] });
  };
  const c = client();
  const r = await c.chat({ model: 'openai/gpt-5.4-mini', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(seen.length, 2);
  assert.equal(signatureOf(seen[0]), null);
  const sig = JSON.parse(Buffer.from(signatureOf(seen[1]), 'base64').toString());
  assert.equal(sig.accepted.network, 'eip155:137');
  assert.equal(sig.payload.authorization.value, '3000');
  assert.equal(r.payment.amount, 3000n);
  assert.equal(r.payment.formattedAmount, '0.003');
  assert.equal(r.payment.transaction, 'b2c1e7a0-uuid');
  assert.equal(r.payment.network, 'polygon');
  assert.equal(c.getSpending().total_micro_usdc, 3000);
});

test('transient errors on the unpaid quote request are retried', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return json({}, 503);
    if (calls === 2) throw new TypeError('fetch failed');
    return calls === 3 ? quote() : settled({ ok: true });
  };
  const r = await client().call('/api/v1/search', { method: 'POST', body: { query: 'x' } });
  assert.equal(calls, 4);
  assert.equal(r.payment.amount, 3000n);
});

for (const failure of ['503', 'network']) test(`signed request is never retried (${failure}) and reports paymentSigned`, async () => {
  let calls = 0, signatures = 0;
  globalThis.fetch = async (_, init) => {
    calls++;
    if (signatureOf(init)) {
      signatures++;
      if (failure === 'network') throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
      return json({ error: 'upstream' }, 503);
    }
    return quote();
  };
  const c = client();
  await assert.rejects(c.chat({ model: 'm', messages: [] }), err => {
    assert.ok(err instanceof NanoRequestError);
    assert.equal(err.paymentSigned, true);
    return true;
  });
  assert.equal(calls, 2);
  assert.equal(signatures, 1);
  assert.equal(c.getSpending().calls, 0);
});

const rejects = [
  ['quote above maxPaymentPerCall', {}, { maxPaymentPerCall: '0.002' }, /exceeds maxPaymentPerCall/],
  ['foreign verifyingContract', { extra: { name: 'GatewayWalletBatched', version: '1', verifyingContract: PAY_TO } }, {}, /verifyingContract/],
  ['zero payTo', { payTo: '0x0000000000000000000000000000000000000000' }, {}, /payTo/],
  ['non-integer amount', { amount: '1.5' }, {}, /non-integer/],
];
for (const [name, override, cfg, pattern] of rejects) test(`refuses to sign: ${name}`, async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return quote(override); };
  await assert.rejects(client(cfg).chat({ model: 'm', messages: [] }), err => {
    assert.ok(err instanceof NanoPaymentRejectedError);
    assert.match(err.message, pattern);
    return true;
  });
  assert.equal(calls, 1);
});

test('quote carried only in the 402 body (pm routes) is paid', async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(new URL(url).pathname, '/api/v1/pm/polymarket/markets');
    if (signatureOf(init)) return settled({ markets: [] });
    const header = (await quote().headers.get('PAYMENT-REQUIRED'));
    return json(JSON.parse(Buffer.from(header, 'base64').toString()), 402);
  };
  const r = await client().pm('polymarket/markets', { limit: 1 });
  assert.equal(calls, 2);
  assert.equal(r.payment.amount, 3000n);
});

test('missing chain option is rejected without signing', async () => {
  globalThis.fetch = async () => quote({ network: 'eip155:8453' });
  await assert.rejects(client().chat({ model: 'm', messages: [] }), NanoPaymentRejectedError);
});

test('server error bodies are surfaced instead of a bare status', async () => {
  globalThis.fetch = async () => json({ error: 'Unknown model: auto' }, 400);
  await assert.rejects(client().chat({ model: 'auto', messages: [] }), err => {
    assert.equal(err.status, 400);
    assert.equal(err.paymentSigned, false);
    assert.match(err.message, /Unknown model: auto/);
    return true;
  });
});

test('video: duration alias, poll replays the POST authorization, spend only on completion', async () => {
  const seen = [];
  let polls = 0;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    seen.push({ url: u, init });
    if (u.pathname === '/api/v1/videos/generations') {
      if (!signatureOf(init)) {
        assert.deepEqual(JSON.parse(init.body), { model: 'xai/grok-imagine-video', prompt: 'cat', duration_seconds: 6 });
        return quote();
      }
      return json({ id: 'xai:1', status: 'queued', model: 'xai/grok-imagine-video', poll_url: '/api/v1/videos/generations/xai%3A1?model=xai%2Fgrok-imagine-video&duration=6&sig=abc' }, 202);
    }
    polls++;
    assert.equal(u.searchParams.get('sig'), 'abc');
    assert.equal(init.redirect, 'error');
    return polls < 2 ? json({ id: 'xai:1', status: 'in_progress' }, 202) : settled({ id: 'xai:1', status: 'completed', url: 'https://cdn/x.mp4' });
  };
  const c = client();
  const { data: job, payment } = await c.videos.generate({ model: 'xai/grok-imagine-video', prompt: 'cat', duration: 6 });
  assert.equal(payment.status, 202);
  assert.equal(c.getSpending().calls, 0);
  const done = await c.videos.wait(job, { intervalMs: 0 });
  assert.equal(done.data.url, 'https://cdn/x.mp4');
  assert.equal(done.payment.amount, 3000n);
  assert.equal(done.payment.transaction, 'b2c1e7a0-uuid');
  const pollHeaders = seen.filter(s => s.url.pathname !== '/api/v1/videos/generations').map(s => new Headers(s.init.headers).get('x-payment'));
  assert.deepEqual(pollHeaders, [job.paymentHeader, job.paymentHeader]);
  assert.equal(c.getSpending().calls, 1);
  assert.equal(c.getSpending().total_micro_usdc, 3000);
});

test('video: upstream failure throws and records no spend', async () => {
  globalThis.fetch = async () => json({ id: 'xai:1', status: 'failed', payment_status: 'not_charged' });
  const c = client();
  const job = { id: 'xai:1', poll_url: '/api/v1/videos/generations/xai%3A1?sig=a', status: 'queued', model: 'm', paymentHeader: 'h', amount: 5n };
  await assert.rejects(c.videos.wait(job, { intervalMs: 0 }), /not charged/);
  assert.equal(c.getSpending().calls, 0);
});

test('video: off-origin poll_url never receives the payment header', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({}); };
  const job = { id: 'x', poll_url: 'https://evil.example/api/v1/videos/generations/x', status: 'queued', model: 'm', paymentHeader: 'h', amount: 1n };
  await assert.rejects(client().videos.status(job), /poll_url/);
  assert.equal(calls, 0);
});

test('tts goes to /audio/speech with response_format; music maps duration', async () => {
  const bodies = {};
  globalThis.fetch = async (url, init) => { bodies[new URL(url).pathname] = JSON.parse(init.body); return json({}); };
  const c = client();
  await c.audio.tts({ model: 'elevenlabs/flash-v2.5', input: 'hi', format: 'wav' });
  await c.music.generate({ model: 'minimax/music-2.5+', prompt: 'lofi', duration: 30 });
  assert.deepEqual(bodies['/api/v1/audio/speech'], { model: 'elevenlabs/flash-v2.5', input: 'hi', response_format: 'wav' });
  assert.deepEqual(bodies['/api/v1/audio/generations'], { model: 'minimax/music-2.5+', prompt: 'lofi', duration_seconds: 30 });
});

test('getPaymentStatus: empty id short-circuits; testnet chains use Circle testnet host', async () => {
  const urls = [];
  globalThis.fetch = async url => { urls.push(String(url)); return json({ status: 'received' }); };
  assert.equal((await client().getPaymentStatus('')).status, 'unknown');
  assert.equal(urls.length, 0);
  const s = await new NanoClient({ chain: 'polygonAmoy', privateKey: KEY }).getPaymentStatus('abc');
  assert.equal(s.status, 'pending');
  assert.equal(urls[0], 'https://gateway-api-testnet.circle.com/v1/x402/transfers/abc');
});

test('repeat polls of a settled job are not counted as new charges', async () => {
  let polls = 0;
  globalThis.fetch = async () => {
    polls++;
    return polls === 1
      ? settled({ id: 'j', status: 'completed', payment: { status: 'settled' } })
      : json({ id: 'j', status: 'completed', payment: { status: 'already_settled' } });
  };
  const c = client();
  const job = { id: 'j', poll_url: '/api/v1/videos/generations/j?sig=a', status: 'queued', paymentHeader: 'h', amount: 5000n };
  const first = await c.videos.status(job);
  const second = await c.videos.status(job);
  await c.videos.wait(job, { intervalMs: 0 });
  assert.equal(first.payment.amount, 5000n);
  assert.equal(second.payment.amount, 0n);
  assert.deepEqual([c.getSpending().calls, c.getSpending().total_micro_usdc], [1, 5000]);
});

test('paid 2xx with a non-JSON body: charged, counted, reported as paymentSigned', async () => {
  globalThis.fetch = async (_, init) => signatureOf(init) ? new Response('OK plain', { status: 200 }) : quote();
  const c = client();
  await assert.rejects(c.call('/api/v1/rpc/ethereum', { method: 'POST', body: {} }), err => {
    assert.ok(err instanceof NanoRequestError);
    assert.equal(err.paymentSigned, true);
    assert.equal(err.body, 'OK plain');
    return true;
  });
  assert.equal(c.getSpending().total_micro_usdc, 3000);
});

test('call() refuses stream:true before any request', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({}); };
  await assert.rejects(client().call('/api/v1/messages', { method: 'POST', body: { stream: true } }), /Streaming/);
  assert.equal(calls, 0);
});

test('Circle lifecycle hooks on paymentScheme run for NanoClient payments', async () => {
  let calls = 0, hooked = 0;
  globalThis.fetch = async () => { calls++; return quote(); };
  const c = client();
  c.paymentScheme.onBeforePaymentCreation(async () => { hooked++; return { abort: true, reason: 'budget' }; });
  await assert.rejects(c.chat({ model: 'm', messages: [] }), /budget/);
  assert.equal(hooked, 1);
  assert.equal(calls, 1);
});

for (const [name, cfg] of [['negative cap', { maxPaymentPerCall: '-1' }], ['non-numeric cap', { maxPaymentPerCall: 'abc' }],
  ['empty cap', { maxPaymentPerCall: '' }], ['sub-micro cap', { maxPaymentPerCall: '0.0000001' }],
  ['NaN retries', { maxRetries: NaN }], ['infinite retries', { maxRetries: Infinity }]]) {
  test(`config validation rejects ${name}`, () => assert.throws(() => client(cfg)));
}
test('a zero cap is a valid free-only mode', () => assert.equal(client({ maxPaymentPerCall: '0' }).maxPaymentPerCall, 0n));

for (const [name, res] of [
  ['garbage header', () => new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': '%%%not-base64-json' } })],
  ['accepts not an array', () => new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': b64({ accepts: {} }) } })],
]) test(`malformed quote (${name}) is a NanoRequestError, nothing signed`, async () => {
  globalThis.fetch = async () => res();
  await assert.rejects(client().chat({ model: 'm', messages: [] }), err => err instanceof NanoRequestError && err.paymentSigned === false);
});
test('null entries in accepts are skipped, not dereferenced', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': b64({ accepts: [null] }) } });
  await assert.rejects(client().chat({ model: 'm', messages: [] }), NanoPaymentRejectedError);
});

test('baseUrl with a path prefix keeps the prefix when polling', async () => {
  const urls = [];
  globalThis.fetch = async url => { urls.push(String(url)); return json({ id: 'j', status: 'in_progress' }, 202); };
  const c = client({ baseUrl: 'https://proxy.example/nano/' });
  await c.videos.status({ id: 'j', poll_url: '/api/v1/videos/generations/j?sig=a', status: 'queued', paymentHeader: 'h', amount: 1n });
  assert.equal(urls[0], 'https://proxy.example/nano/api/v1/videos/generations/j?sig=a');
  await assert.rejects(c.videos.status({ id: 'j', poll_url: 'https://proxy.example/api/v1/videos/generations/j', status: 'q', paymentHeader: 'h', amount: 1n }), /poll_url/);
});

test('202 submits report amount 0; slow image jobs can be polled to completion', async () => {
  let n = 0;
  globalThis.fetch = async (url, init) => {
    n++;
    if (n === 1) return quote();
    if (n === 2) return json({ id: 'img1', status: 'queued', poll_url: '/api/v1/images/generations/img1?sig=s' }, 202);
    assert.equal(new Headers(init.headers).get('x-payment'), job.paymentHeader);
    return settled({ id: 'img1', status: 'completed', payment: { status: 'settled' }, data: [{ url: 'https://cdn/i.png' }] });
  };
  const c = client();
  const r = await c.images.generate({ model: 'openai/gpt-image-2', prompt: 'cat' });
  assert.equal(r.payment.status, 202);
  assert.equal(r.payment.amount, 0n);
  assert.equal(c.getSpending().calls, 0);
  assert.ok(isNanoAsyncJob(r.data));
  var job = r.data;
  const done = await c.images.wait(job, { intervalMs: 0 });
  assert.equal(done.payment.amount, 3000n);
  assert.equal(c.getSpending().calls, 1);
});

test('transfer id is read from X-Payment-Response (pm / exa routes)', async () => {
  globalThis.fetch = async (_, init) => signatureOf(init)
    ? json({ markets: [] }, 200, { 'X-Payment-Response': b64({ success: true, transaction: 'pm-uuid' }) })
    : quote();
  const r = await client().pm('polymarket/markets');
  assert.equal(r.payment.transaction, 'pm-uuid');
});
