import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workspace = fileURLToPath(new URL('../../../', import.meta.url));

describe.each(['web', 'pos'])('%s loads the root environment through real Next startup', (app) => {
  it.each(['development', 'production'])('loads EDITION from .env after Next has loaded the empty app directory in %s', (mode) => {
    const temporary = mkdtempSync(path.join(os.tmpdir(), 'capella-frontend-env-'));
    try {
      const appDirectory = path.join(temporary, 'apps', app);
      mkdirSync(appDirectory, { recursive: true });
      writeFileSync(path.join(temporary, '.env'), 'EDITION=full\nAPI_PROXY_TARGET=http://root-api:4000\n');
      writeFileSync(path.join(temporary, '.env.development'), 'API_PROXY_TARGET=http://development-api:4000\n');
      copyFileSync(path.join(workspace, 'apps', app, 'next.config.ts'), path.join(appDirectory, 'next.config.ts'));
      symlinkSync(path.join(workspace, 'apps', app, 'node_modules'), path.join(appDirectory, 'node_modules'), 'junction');
      const script = `
        const loadConfig = require('next/dist/server/config').default;
        loadConfig(${JSON.stringify(mode === 'development' ? 'phase-development-server' : 'phase-production-build')}, process.cwd())
          .then(async config => console.log(JSON.stringify({ rewrites: await config.rewrites(), edition: process.env.EDITION })))
          .catch(error => { console.error(error.message); process.exitCode = 1; });
      `;
      const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: mode };
      delete env.EDITION;
      delete env.API_PROXY_TARGET;
      delete env.__NEXT_PROCESSED_ENV;
      const output = execFileSync(process.execPath, ['-e', script], { cwd: appDirectory, env, encoding: 'utf8', timeout: 30_000 });
      expect(JSON.parse(output.trim())).toEqual({
        edition: 'full',
        rewrites: [{ source: '/api/:path*', destination: mode === 'development' ? 'http://development-api:4000/api/:path*' : 'http://root-api:4000/api/:path*' }],
      });
    } finally {
      // Only this test's mkdtemp directory; junction removal leaves its target intact.
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 40_000);
});
