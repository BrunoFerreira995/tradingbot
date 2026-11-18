const { join } = require('node:path');

const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'tradingbot-api',
      cwd: root,
      script: 'bun',
      args: '--env-file=.env apps/api/src/index.ts',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      kill_timeout: 15000,
      kill_signal: 'SIGTERM',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'tradingbot-web',
      cwd: join(root, 'apps/web'),
      script: join(root, 'node_modules/next/dist/bin/next'),
      args: 'start -p 3002',
      interpreter: 'node',
      node_args: '--env-file=../../.env',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      kill_timeout: 15000,
      kill_signal: 'SIGTERM',
      time: true,
      env: {
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
};
