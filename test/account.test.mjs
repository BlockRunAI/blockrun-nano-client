import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BlockRunAccountClient, BlockRunAccountError, NanoClient } from '../dist/index.js';
const originalFetch = globalThis.fetch;
const key = 'brk_test_fixture_only';
const client = () => new BlockRunAccountClient({ apiKey: key });
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
afterEach(() => { globalThis.fetch = originalFetch; });

test('account calls keep tool/schema fields and omit wallet/payment headers and receipts', async () => {
  const body = { model: 'openai/gpt-4o-mini', messages: [], tools: [{type:'function'}], response_format: {type:'json_schema'} };
  globalThis.fetch = async (url, init) => {
    assert.equal(url.href, 'https://api.blockrun.ai/v1/chat/completions');
    assert.equal(init.headers.get('authorization'), `Bearer ${key}`);
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(init.body), body);
    for (const name of init.headers.keys()) assert.ok(!/payment|wallet/i.test(name));
    return json({choices: []});
  };
  assert.deepEqual(await client().chat(body), {data:{choices:[]},billing:{mode:'account',status:200}});
  assert.equal(typeof NanoClient, 'function');
});

for (const status of [401, 402, 429, 500]) test(`HTTP ${status} is actionable, redacted and never replayed`, async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({error: key}, status, {'retry-after':'10'}); };
  await assert.rejects(client().chat({model:'test',messages:[]}), err => {
    assert.ok(err instanceof BlockRunAccountError);
    assert.equal(err.status, status);
    assert.equal(err.retryAfter, '10');
    assert.ok(!err.message.includes(key));
    return true;
  });
  assert.equal(calls, 1);
});

test('credentials cannot escape through arbitrary URLs, traversal, redirects or header overrides', async () => {
  let calls = 0;
  globalThis.fetch = async (_, init) => {
    calls++;
    assert.equal(init.headers.get('authorization'), `Bearer ${key}`);
    assert.equal(init.headers.get('x-payment'), null);
    assert.equal(init.headers.get('x-api-key'), null);
    assert.equal(init.redirect, 'error');
    return json({});
  };
  for (const path of ['https://other.test/v1/models', '//other.test/v1/models', '/v1/../../admin', '/admin', 'https://user@api.blockrun.ai/v1/models']) {
    await assert.rejects(client().call(path));
  }
  assert.equal(calls, 0);
  await client().call('/v1/models', {headers:{authorization:'bad','x-payment':'bad','x-api-key':'bad'}});
  assert.equal(calls, 1);
  for (const baseUrl of ['http://api.blockrun.ai', 'https://api.blockrun.ai/other', 'https://api.blockrun.ai?x=1']) {
    assert.throws(() => new BlockRunAccountClient({apiKey:key,baseUrl}));
  }
});

function stream(chunks) {
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  }));
  return () => cancelled;
}
const bytes = text => new TextEncoder().encode(text);
test('SSE handles byte fragmentation, CRLF, multiline data and DONE without waiting for EOF', async () => {
  const text = ': ping\r\ndata: {"text":\r\ndata: "你好"}\r\n\r\ndata: [DONE]\r\n\r\ndata: invalid\n\n';
  const data = bytes(text);
  const cancelled = stream(Array.from(data, n => new Uint8Array([n])));
  const chunks = [];
  for await (const chunk of client().chatStream({model:'test',messages:[]})) chunks.push(chunk);
  assert.deepEqual(chunks, [{text:'你好'}]);
  assert.ok(cancelled());
});
test('SSE cancels on early consumer exit and rejects upstream error events', async () => {
  const cancelled = stream([bytes('data: {"ok":1}\n\n')]);
  for await (const _ of client().chatStream({model:'test',messages:[]})) break;
  assert.ok(cancelled());
  stream([bytes('data: {"error":"upstream"}\n\n')]);
  await assert.rejects(async () => { for await (const _ of client().chatStream({model:'test',messages:[]})) {} }, /stream reported an error/);
});
test('SSE flushes final data without a trailing newline', async () => {
  globalThis.fetch = async () => new Response('data: {"ok":true}');
  const chunks = [];
  for await (const chunk of client().chatStream({model:'test',messages:[]})) chunks.push(chunk);
  assert.deepEqual(chunks, [{ok:true}]);
});

test('media helpers dispatch correct endpoints and map legacy fields', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push([url.pathname, JSON.parse(init.body)]); return json({}); };
  const c = client();
  await c.images.generate({model:'image',prompt:'x'});
  await c.images.edit({model:'image',prompt:'x',image:'data:image/png;base64,AA=='});
  await c.videos.generate({model:'video',prompt:'x',duration:5});
  await c.videos.generate({model:'video',prompt:'x',duration:5,duration_seconds:8});
  await c.music.generate({model:'music',prompt:'x'});
  await c.audio.tts({model:'tts',input:'hello',format:'mp3'});
  await c.audio.soundEffects({model:'sfx',text:'tap',duration_seconds:0.5});
  assert.deepEqual(calls.map(c => c[0]), ['/v1/images/generations','/v1/images/image2image','/v1/videos/generations','/v1/videos/generations','/v1/audio/generations','/v1/audio/speech','/v1/audio/sound-effects']);
  assert.equal(calls[2][1].duration_seconds, 5);
  assert.equal(calls[2][1].duration, undefined);
  assert.equal(calls[3][1].duration_seconds, 8);
  assert.equal(calls[5][1].response_format, 'mp3');
  assert.equal(calls[5][1].format, undefined);
});

test('async polling preserves signed query and only GETs existing jobs', async () => {
  let calls = 0;
  const pollUrl = 'https://api.blockrun.ai/api/v1/videos/generations/job?sig=a%2Bb&duration=5';
  globalThis.fetch = async (url, init) => {
    assert.equal(url.href, pollUrl);
    assert.equal(init.method, 'GET');
    return json({status:++calls === 2 ? 'completed':'in_progress'});
  };
  assert.equal((await client().poll(pollUrl, {intervalMs:0,maxAttempts:2})).data.status, 'completed');
  assert.equal(calls, 2);
});
test('failed and expired polls do not resubmit or leak signed URLs', async () => {
  let calls = 0;
  globalThis.fetch = async (_, init) => { calls++; assert.equal(init.method, 'GET'); return json({status:'failed'}); };
  await assert.rejects(client().poll('/v1/videos/generations/job?sig=secret', {intervalMs:0}), /generation failed/);
  assert.equal(calls, 1);
  globalThis.fetch = async () => json({status:'queued'});
  await assert.rejects(client().poll('/v1/videos/generations/job', {intervalMs:0,maxAttempts:1}), /same poll_url/);
});
test('market data, Signal and generic service requests use account transport', async () => {
  const paths = [];
  globalThis.fetch = async (url) => { paths.push(url.pathname + url.search); return json({}); };
  const c = client();
  await c.price.price('BTC/USD');
  await c.price.history('BTC/USD',{from:100,to:200,resolution:'D'});
  await c.price.pm('markets/search',{q:'bitcoin'});
  await c.x.call('users/info',{userName:'blockrunai'});
  await c.call('/v1/surf/market/ranking');
  assert.deepEqual(paths, ['/v1/crypto/price/BTC-USD','/v1/crypto/history/BTC-USD?from=100&to=200&resolution=D','/v1/pm/markets/search?q=bitcoin','/v1/x/users/info?userName=blockrunai','/v1/surf/market/ranking']);
});
