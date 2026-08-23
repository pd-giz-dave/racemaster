'use strict';

import { jsonReply } from './http-utils.js';
import { PORT } from './config.js';
import { handleAuthRoutes } from './routes/auth.js';
import { handleDatasetRoutes } from './routes/datasets.js';
import { handleMobileRoutes } from './routes/mobile.js';
import { handleUserRoutes } from './routes/users.js';
import { handleResultsRoutes } from './routes/results.js';
import { handleStaticRoutes } from './routes/static.js';

// Route groups are tried in this exact order — datasets/mobile/users/results/static are each
// internally ordered the same way the original single-file handler was (e.g. the
// bib-allocations POST route in routes/mobile.js is checked before the general mobile POST
// route it would otherwise be swallowed by), so preserving THIS top-level order matters just
// as much as preserving each group's own internal order.
export async function route(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;
  const force = url.searchParams.get('force') === 'true';

  try {
    // GET /api/ping  — liveness check, no auth. `sink: true` is this server's own explicit
    // "I am a genuine data destination" declaration — mobile-sync data pushed here (see
    // POST /api/mobile/:raceLabel) is what the Android app's own sync coloring treats as
    // fully confirmed (green), same status a Bluetooth destination that identifies as a sink
    // gets (see mule-ble.js's own ack write).
    if (pathname === '/api/ping' && req.method === 'GET') {
      jsonReply(res, 200, { ok: true, sink: true });
      return;
    }

    if (await handleAuthRoutes(req, res, pathname))               return;
    if (await handleDatasetRoutes(req, res, pathname, force))     return;
    if (await handleMobileRoutes(req, res, pathname))             return;
    if (await handleUserRoutes(req, res, pathname))                return;
    if (await handleResultsRoutes(req, res, pathname))             return;
    await handleStaticRoutes(req, res, pathname);

  } catch (e) {
    console.error('Request error:', e.message);
    jsonReply(res, 500, { error: 'Server error' });
  }
}