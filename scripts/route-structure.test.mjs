import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appPath = (...parts) => resolve(projectRoot, 'app', ...parts);

test('uses a login gate and a protected home route instead of tabs', () => {
  assert.equal(existsSync(appPath('(auth)', 'login.tsx')), true);
  assert.equal(existsSync(appPath('(app)', 'home.tsx')), true);
  assert.equal(existsSync(appPath('(app)', '_layout.tsx')), true);
  assert.equal(existsSync(appPath('(tabs)', '_layout.tsx')), false);
  assert.equal(existsSync(appPath('(tabs)', 'explore.tsx')), false);

  const indexRoute = readFileSync(appPath('index.tsx'), 'utf8');
  const protectedLayout = readFileSync(appPath('(app)', '_layout.tsx'), 'utf8');
  assert.match(indexRoute, /token \? '\/home' : '\/login'/);
  assert.match(protectedLayout, /<Redirect href="\/login"/);
});

test('separates feature lists from detail and edit routes', () => {
  const expectedRoutes = [
    ['tasks', 'index.tsx'],
    ['tasks', '[taskId].tsx'],
    ['notes', 'index.tsx'],
    ['notes', '[noteId].tsx'],
    ['canvas', 'index.tsx'],
    ['canvas', '[canvasId].tsx'],
  ];

  for (const route of expectedRoutes) {
    assert.equal(existsSync(appPath('(app)', ...route)), true, `missing ${route.join('/')}`);
  }

  const homeRoute = readFileSync(appPath('(app)', 'home.tsx'), 'utf8');
  assert.match(homeRoute, /path: '\/notes'/);
  assert.match(homeRoute, /path: '\/tasks'/);
  assert.match(homeRoute, /path: '\/canvas'/);
  assert.match(homeRoute, /path: '\/agent'/);
});
