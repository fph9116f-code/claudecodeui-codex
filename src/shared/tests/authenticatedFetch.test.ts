import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

/**
 * The shared API request helper. Login was removed, so the important
 * invariants are that it sends no credentials, labels bodies correctly, lets
 * callers override headers, and never replays cached API responses.
 */

let lastInit: RequestInit | undefined;

const loadFetch = async () => {
  vi.resetModules();
  return (await import('@/shared/api')).authenticatedFetch;
};

const respondWith = () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    lastInit = init;
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const sentHeaders = () => (lastInit?.headers ?? {}) as Record<string, string>;

beforeEach(() => {
  localStorage.clear();
  lastInit = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('no login credentials are attached, even if a legacy token is stored', async () => {
  // A token left over from the removed login flow must never go back on the wire.
  localStorage.setItem('auth-token', 'legacy-token');
  respondWith();

  await (await loadFetch())('/api/projects');

  assert.equal('Authorization' in sentHeaders(), false);
});

test('a JSON body is labelled as JSON', async () => {
  respondWith();

  await (await loadFetch())('/api/projects', { method: 'POST', body: '{"a":1}' });

  assert.equal(sentHeaders()['Content-Type'], 'application/json');
});

test('a FormData body is left for the browser to label', async () => {
  // Setting Content-Type by hand drops the multipart boundary and the upload
  // arrives unparseable.
  respondWith();

  await (await loadFetch())('/api/upload', { method: 'POST', body: new FormData() });

  assert.equal('Content-Type' in sentHeaders(), false);
});

test('a caller header wins over the default', async () => {
  respondWith();

  await (await loadFetch())('/api/projects', {
    method: 'POST',
    body: 'raw',
    headers: { 'Content-Type': 'text/plain' },
  });

  assert.equal(sentHeaders()['Content-Type'], 'text/plain');
});

test('requests bypass the HTTP cache', async () => {
  respondWith();

  await (await loadFetch())('/api/projects');

  assert.equal(lastInit?.cache, 'no-store');
});
