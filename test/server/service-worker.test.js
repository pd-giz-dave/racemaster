'use strict';

import { scratchRoot } from './helpers/setup-root.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { walkFiles, buildSwContent } from '../../server/service-worker.js';

const SW_TEMPLATE = `'use strict';
const CACHE = 'racemaster-placeholder';
const PRECACHE = [
  '/',
];
self.addEventListener('install', () => {});
`;

beforeEach(() => {
  for (const d of ['css', 'js', 'nested']) fs.rmSync(path.join(scratchRoot, d), { recursive: true, force: true });
  fs.writeFileSync(path.join(scratchRoot, 'sw.js'), SW_TEMPLATE, 'utf8');
});

describe('server/service-worker.js:walkFiles', () => {
  it('recursively collects files matching the given extensions', () => {
    fs.mkdirSync(path.join(scratchRoot, 'js', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(scratchRoot, 'js', 'a.js'), '', 'utf8');
    fs.writeFileSync(path.join(scratchRoot, 'js', 'a.css'), '', 'utf8'); // wrong dir but present
    fs.writeFileSync(path.join(scratchRoot, 'js', 'sub', 'b.js'), '', 'utf8');
    fs.writeFileSync(path.join(scratchRoot, 'js', 'ignored.txt'), '', 'utf8');

    const found = walkFiles(path.join(scratchRoot, 'js'), ['.js']).map(f => path.relative(scratchRoot, f)).sort();
    assert.deepEqual(found, [path.join('js', 'a.js'), path.join('js', 'sub', 'b.js')]);
  });
});

describe('server/service-worker.js:buildSwContent', () => {
  it('replaces CACHE with a fingerprint and PRECACHE with the discovered file list', () => {
    fs.mkdirSync(path.join(scratchRoot, 'js'), { recursive: true });
    fs.writeFileSync(path.join(scratchRoot, 'js', 'app.js'), 'console.log(1)', 'utf8');

    const content = buildSwContent();
    assert.match(content, /const CACHE = 'racemaster-[0-9a-f]{12}';/);
    assert.match(content, /const PRECACHE = \[[\s\S]*'\/js\/app\.js',[\s\S]*\];/);
    assert.match(content, /'\/',/); // always precaches the root
  });

  it('excludes sw.js itself from PRECACHE even if discovered under js/', () => {
    fs.mkdirSync(path.join(scratchRoot, 'js'), { recursive: true });
    fs.writeFileSync(path.join(scratchRoot, 'js', 'sw.js'), '', 'utf8'); // decoy, not the real /sw.js
    const content = buildSwContent();
    const precacheBlock = content.match(/const PRECACHE = \[[\s\S]*?\];/)[0];
    assert.doesNotMatch(precacheBlock, /'\/sw\.js'/);
  });

  it('produces a different fingerprint when a discovered file\'s mtime changes', () => {
    fs.mkdirSync(path.join(scratchRoot, 'js'), { recursive: true });
    const assetPath = path.join(scratchRoot, 'js', 'app.js');
    fs.writeFileSync(assetPath, 'v1', 'utf8');
    const first = buildSwContent().match(/racemaster-([0-9a-f]{12})/)[1];

    fs.utimesSync(assetPath, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    const second = buildSwContent().match(/racemaster-([0-9a-f]{12})/)[1];

    assert.notEqual(first, second);
  });

  it('is fine with no css/ or js/ directories at all (statics only)', () => {
    const content = buildSwContent();
    assert.match(content, /const CACHE = 'racemaster-[0-9a-f]{12}';/);
  });
});
