'use strict';

// strings.js is pure declarative data (TOOLTIPS/HELP/PAGES/TABLES constants, no functions) —
// skipped, same reasoning as roles.js/si-schema.js/csv-schema.js. presence.js has
// real cross-tab coordination logic worth testing, using Node's real BroadcastChannel (no need
// to mock it) with the test acting as a second "tab" on the same channel.

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const CHANNEL_NAME = 'racemaster-presence';

function makeBannerEl() {
  return { hidden: true, textContent: '', style: {} };
}

function installDocumentMock(el) {
  globalThis.document = { getElementById: (id) => (id === 'header-multitab-warning' ? el : null) };
}

// BroadcastChannel delivery is genuinely asynchronous (a real cross-instance postMessage, not
// just a microtask) — a short real wait is simpler and less fragile here than choreographing
// fake timers through it (see mule-ble.test.js for how deep that rabbit hole gets).
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));

let startPresenceWatch;
beforeEach(async () => {
  globalThis.window = new EventTarget();
  // Fresh module instance per test would be ideal (tabId/channel/peers are module-level
  // singletons) but ESM caches by specifier — instead each test explicitly closes out via
  // startPresenceWatch(null) at the end where it matters, and tests are written to not depend
  // on a clean `peers` map at start.
  ({ startPresenceWatch } = await import('../js/presence.js'));
});

after(() => {
  startPresenceWatch?.(null); // stop the heartbeat interval so the test process can exit cleanly
});

describe('presence.js:startPresenceWatch', () => {
  it('does nothing (no channel, banner stays hidden) with no dataset', async () => {
    const el = makeBannerEl();
    installDocumentMock(el);
    startPresenceWatch(null);
    await wait();
    assert.equal(el.hidden, true);
  });

  it('announces itself with a "hello" broadcast on the shared channel', async () => {
    const el = makeBannerEl();
    installDocumentMock(el);
    const testChannel = new BroadcastChannel(CHANNEL_NAME);
    const received = new Promise(resolve => { testChannel.onmessage = e => resolve(e.data); });

    startPresenceWatch('me/race-hello-test');
    const msg = await received;

    assert.equal(msg.type, 'hello');
    assert.equal(msg.dataset, 'me/race-hello-test');
    assert.ok(msg.tabId);
    testChannel.close();
  });

  it('shows the multi-tab banner when another tab announces itself on the same dataset, and replies with a heartbeat', async () => {
    const el = makeBannerEl();
    installDocumentMock(el);
    startPresenceWatch('me/race-peer-test');
    await wait();

    const testChannel = new BroadcastChannel(CHANNEL_NAME);
    const heartbeat = new Promise(resolve => { testChannel.onmessage = e => resolve(e.data); });
    testChannel.postMessage({ type: 'hello', tabId: 'other-tab', dataset: 'me/race-peer-test' });

    const reply = await heartbeat;
    assert.equal(reply.type, 'heartbeat');
    assert.equal(el.hidden, false);
    assert.match(el.textContent, /also open in another tab/);
    testChannel.close();
  });

  it('ignores a peer announcement for a different dataset', async () => {
    const el = makeBannerEl();
    installDocumentMock(el);
    startPresenceWatch('me/race-isolated');
    await wait();

    const testChannel = new BroadcastChannel(CHANNEL_NAME);
    testChannel.postMessage({ type: 'hello', tabId: 'other-tab', dataset: 'a-totally-different-dataset' });
    await wait();

    assert.equal(el.hidden, true);
    testChannel.close();
  });

  it('hides the banner again once the peer says goodbye', async () => {
    const el = makeBannerEl();
    installDocumentMock(el);
    startPresenceWatch('me/race-bye-test');
    await wait();

    const testChannel = new BroadcastChannel(CHANNEL_NAME);
    testChannel.postMessage({ type: 'hello', tabId: 'other-tab', dataset: 'me/race-bye-test' });
    await wait();
    assert.equal(el.hidden, false);

    testChannel.postMessage({ type: 'bye', tabId: 'other-tab', dataset: 'me/race-bye-test' });
    await wait();
    assert.equal(el.hidden, true);

    testChannel.close();
  });

  it('sends "bye" on its own old channel when switching datasets', async () => {
    const el = makeBannerEl();
    installDocumentMock(el);
    const testChannel = new BroadcastChannel(CHANNEL_NAME);

    startPresenceWatch('me/race-switch-1');
    await wait();

    const byePromise = new Promise(resolve => {
      testChannel.onmessage = e => { if (e.data.type === 'bye') resolve(e.data); };
    });
    startPresenceWatch('me/race-switch-2'); // triggers 'bye' on the first channel before switching
    const bye = await byePromise;

    assert.equal(bye.dataset, 'me/race-switch-1');
    testChannel.close();
  });
});
