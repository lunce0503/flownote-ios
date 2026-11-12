import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = '8080';
const DEFAULT_MAX_WORKERS = '1';

const requireHttpsUrl = (name, value) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} is required.`);
  }

  const url = new URL(trimmed);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.up.railway.app') || url.username || url.password || url.port) {
    throw new Error(`${name} must use HTTPS.`);
  }

  return url.toString().replace(/\/$/, '');
};

export const resolveExpoGoRailwayConfig = (env = process.env) => {
  const publicDomain = env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (!publicDomain) {
    throw new Error('RAILWAY_PUBLIC_DOMAIN is required for the Expo Go service.');
  }

  const port = env.PORT?.trim() || DEFAULT_PORT;
  if (!/^\d+$/.test(port)) {
    throw new Error('PORT must be numeric.');
  }

  return {
    apiUrl: requireHttpsUrl('EXPO_PUBLIC_WAS_URL', env.EXPO_PUBLIC_WAS_URL),
    maxWorkers: env.EXPO_MAX_WORKERS?.trim() || DEFAULT_MAX_WORKERS,
    port,
    proxyUrl: requireHttpsUrl('RAILWAY_PUBLIC_DOMAIN', `https://${publicDomain}`),
  };
};

export const createExpoGoProcess = (env = process.env) => {
  const config = resolveExpoGoRailwayConfig(env);
  const expoExecutable = path.resolve('node_modules/.bin/expo');
  const args = [
    'start',
    '--go',
    '--host',
    'lan',
    '--port',
    config.port,
    '--no-dev',
    '--minify',
    '--max-workers',
    config.maxWorkers,
  ];

  return {
    args,
    command: expoExecutable,
    config,
    env: {
      ...env,
      CI: '1',
      EXPO_NO_TELEMETRY: '1',
      EXPO_PACKAGER_PROXY_URL: config.proxyUrl,
      EXPO_PUBLIC_WAS_URL: config.apiUrl,
    },
  };
};

export const startExpoGoRailway = (env = process.env) => {
  const processConfig = createExpoGoProcess(env);
  console.log(`Expo Go manifest: ${processConfig.config.proxyUrl}`);
  console.log(`Flownote API: ${processConfig.config.apiUrl}`);

  const child = spawn(processConfig.command, processConfig.args, {
    env: processConfig.env,
    stdio: 'inherit',
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });

  return child;
};

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  startExpoGoRailway();
}
