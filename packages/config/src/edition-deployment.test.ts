import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryFile = (relativePath: string) => fileURLToPath(
  new URL(`../../../${relativePath}`, import.meta.url),
);

const serviceBlock = (compose: string, name: string) => {
  const match = compose.match(new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|^networks:)`, 'm'));
  if (!match?.[1]) throw new Error(`Missing Compose service ${name}`);
  return match[1];
};

describe('edition deployment contract', () => {
  const compose = readFileSync(repositoryFile('docker-compose.yml'), 'utf8');

  it('includes the edition in Turbo build cache keys', () => {
    const turbo = JSON.parse(readFileSync(repositoryFile('turbo.json'), 'utf8')) as {
      tasks: { build: { env?: string[] } };
    };
    expect(turbo.tasks.build.env).toContain('EDITION');
    expect(turbo.tasks.build.env).toContain('API_PROXY_TARGET');
  });

  it('keeps migrations edition-independent', () => {
    const migrate = serviceBlock(compose, 'migrate');
    expect(migrate).not.toContain('profiles:');
    expect(migrate).not.toContain('EDITION:');
  });

  it('assigns worker and frontend containers to the supported edition profiles', () => {
    expect(serviceBlock(compose, 'worker')).toContain('profiles: ["hr", "erp", "full"]');
    expect(serviceBlock(compose, 'web')).toContain('profiles: ["hr", "erp", "full"]');
    expect(serviceBlock(compose, 'pos')).toContain('profiles: ["erp", "full"]');
  });

  it('blocks direct HR-only routes from the ERP attendance surface', () => {
    const middlewarePath = repositoryFile('apps/web/src/middleware.ts');
    expect(existsSync(middlewarePath)).toBe(true);
    if (!existsSync(middlewarePath)) return;
    const middleware = readFileSync(middlewarePath, 'utf8');
    for (const route of ['/dashboard', '/weekly-day-off', '/payroll', '/bonuses', '/deductions', '/advances', '/reports', '/self-service']) {
      expect(middleware).toContain(`'${route}'`);
    }
  });

  it('uses the same explicit profile value for Compose selection and runtime validation', () => {
    expect(readFileSync(repositoryFile('.env.example'), 'utf8')).toContain('COMPOSE_PROFILES=full');
    expect(serviceBlock(compose, 'api')).toContain(
      'COMPOSE_PROFILES: ${COMPOSE_PROFILES:?COMPOSE_PROFILES must match EDITION}',
    );
    expect(serviceBlock(compose, 'worker')).toContain(
      'COMPOSE_PROFILES: ${COMPOSE_PROFILES:?COMPOSE_PROFILES must match EDITION}',
    );

    const documentation = readFileSync(repositoryFile('docs/docker.md'), 'utf8');
    expect(documentation).not.toContain('--profile full');
    expect(documentation).toContain('COMPOSE_PROFILES=full');
  });

  it('passes the selected edition into both frontend builds', () => {
    for (const dockerfile of ['dockerfile.web', 'dockerfile.pos']) {
      const source = readFileSync(repositoryFile(dockerfile), 'utf8');
      expect(source).toContain('ARG EDITION');
      expect(source).toContain('ENV EDITION=$EDITION');
    }
  });

  it('keeps browser API requests same-origin and gives both frontend servers a private API target', () => {
    const configPackage = JSON.parse(
      readFileSync(repositoryFile('packages/config/package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };
    expect(configPackage.exports).not.toHaveProperty('./client');

    for (const serviceName of ['web', 'pos']) {
      const service = serviceBlock(compose, serviceName);
      expect(service).toContain('API_PROXY_TARGET: http://api:4000');
      expect(service).not.toContain('NEXT_PUBLIC_API_URL');
    }
    for (const dockerfile of ['dockerfile.web', 'dockerfile.pos']) {
      const source = readFileSync(repositoryFile(dockerfile), 'utf8');
      expect(source).toContain('ARG API_PROXY_TARGET=http://api:4000');
      expect(source).not.toContain('NEXT_PUBLIC_API_URL');
    }
  });

  it.each([
    'deploy/nginx/recommended-subdomains.conf.example',
    'deploy/nginx/separate-domains.conf.example',
  ])('routes each frontend and its API under the same origin in %s', (relativePath) => {
    const nginx = readFileSync(repositoryFile(relativePath), 'utf8');

    expect(nginx.match(/listen 443 ssl http2;/g)).toHaveLength(2);
    expect(nginx).not.toContain('http2 on;');
    expect(nginx.match(/location \/api\//g)).toHaveLength(2);
    expect(nginx.match(/proxy_pass http:\/\/127\.0\.0\.1:4020/g)).toHaveLength(2);
    expect(nginx.match(/client_max_body_size 17m/g)).toHaveLength(2);
    expect(nginx).toContain('proxy_pass http://127.0.0.1:3020');
    expect(nginx).toContain('proxy_pass http://127.0.0.1:3021');
    expect(nginx.match(/proxy_set_header Host \$host/g)).toHaveLength(4);
    expect(nginx.match(/proxy_set_header X-Forwarded-Proto \$scheme/g)).toHaveLength(4);
    expect(nginx.match(/proxy_set_header X-Forwarded-For \$remote_addr/g)).toHaveLength(4);
    expect(nginx).not.toContain('Access-Control-Allow-Origin');
  });

  it('documents the completed multi-frontend security rollout and verification', () => {
    const tracker = readFileSync(repositoryFile('docs/tmp-backend-progress.md'), 'utf8');
    const erp22 = tracker.match(/## ERP 22\.[\s\S]*?(?=## ERP locked exclusions)/)?.[0];
    expect(erp22).toBeDefined();
    expect(erp22).not.toContain('- [ ]');

    const deployment = readFileSync(repositoryFile('docs/docker.md'), 'utf8');
    expect(deployment).toContain('deploy/nginx/recommended-subdomains.conf.example');
    expect(deployment).toContain('deploy/nginx/separate-domains.conf.example');
    expect(deployment).toContain('INVALID_ORIGIN');
    expect(deployment).toContain('host-only');
    expect(deployment).toContain('independent');

    const plan = readFileSync(repositoryFile('docs/erp-plan.md'), 'utf8');
    expect(plan).not.toContain('api.customer.com');
  });
});
