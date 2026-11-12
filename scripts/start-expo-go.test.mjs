import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExpoGoProcess,
  resolveExpoGoRailwayConfig,
} from './start-expo-go.mjs';

const productionEnv = {
  EXPO_PUBLIC_WAS_URL: 'https://flownote-api-production.up.railway.app',
  PORT: '8080',
  RAILWAY_PUBLIC_DOMAIN: 'flownote-mobile-production.up.railway.app',
};

test('builds a Railway HTTPS proxy URL for Expo Go manifests and bundles', () => {
  const config = resolveExpoGoRailwayConfig(productionEnv);

  assert.equal(config.apiUrl, 'https://flownote-api-production.up.railway.app');
  assert.equal(config.port, '8080');
  assert.equal(config.proxyUrl, 'https://flownote-mobile-production.up.railway.app');
});

test('starts Expo Go in production bundle mode on the Railway port', () => {
  const processConfig = createExpoGoProcess(productionEnv);

  assert.deepEqual(processConfig.args, [
    'start',
    '--go',
    '--host',
    'lan',
    '--port',
    '8080',
    '--no-dev',
    '--minify',
    '--max-workers',
    '1',
  ]);
  assert.equal(
    processConfig.env.EXPO_PACKAGER_PROXY_URL,
    'https://flownote-mobile-production.up.railway.app'
  );
});

test('rejects missing Railway and insecure API configuration', () => {
  assert.throws(
    () => resolveExpoGoRailwayConfig({ EXPO_PUBLIC_WAS_URL: productionEnv.EXPO_PUBLIC_WAS_URL }),
    /RAILWAY_PUBLIC_DOMAIN/
  );
  assert.throws(
    () => resolveExpoGoRailwayConfig({
      ...productionEnv,
      EXPO_PUBLIC_WAS_URL: 'http://flownote-api.internal',
    }),
    /must use HTTPS/
  );
});
