# Docker Deploy Guide

This guide follows the normal Docker flow for this repository: prepare env, build/start, verify migrations, then verify the published services.

## Environment Files

- `.env`: local non-Docker development.
- `.env.docker`: local Docker Compose on your PC.
- `.env.production`: production Docker Compose on a VPS.

Production uses:

```bash
docker compose --env-file .env.production ...
```

Local Docker uses:

```bash
docker compose --env-file .env.docker ...
```

## Service Layout

This project runs three long-lived services and one one-shot migration service:

- `db`: MySQL
- `api`: Express API
- `web`: Next.js app
- `migrate`: runs `db:migrate` before `api` starts

Inside Docker:

- `api` talks to MySQL with `DATABASE_URL=mysql://...@db:3306/...`
- browser requests use `NEXT_PUBLIC_API_URL`, not the internal Docker hostname
- the `migrate` service waits for MySQL health, then applies Drizzle migrations before the API starts

Default published host ports for this repo:

- `web`: `3020`
- `api`: `4020`

Container-internal ports stay:

- `web`: `3000`
- `api`: `4000`
- `db`: `3306`

## Required Environment Values

Keep these aligned in `.env.docker` and `.env.production`:

```env
MYSQL_ROOT_PASSWORD=<secret>
MYSQL_DATABASE=capella_hr
MYSQL_USER=capella
MYSQL_PASSWORD=<secret>

DATABASE_URL=mysql://capella:<secret>@db:3306/capella_hr

API_HOST_PORT=4020
WEB_HOST_PORT=3020

NEXT_PUBLIC_API_URL=http://localhost:4020
CORS_ALLOWED_ORIGINS=http://localhost:3020

JWT_ACCESS_SECRET=<secret>
JWT_REFRESH_SECRET=<secret>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
COOKIE_SECURE=false

ADMIN_NAME=Capella Admin
ADMIN_EMAIL=admin@capella.eg
ADMIN_PASSWORD=<secret>

UPLOAD_MAX_BYTES=52428800
UPLOAD_ALLOWED_MIME_TYPES=image/png,image/jpeg,image/webp,video/mp4,video/webm
```

Production notes:

- local Docker should keep `NEXT_PUBLIC_API_URL=http://localhost:4020`
- behind a reverse proxy, set `NEXT_PUBLIC_API_URL` to the public API path or URL that the browser can reach
- set `CORS_ALLOWED_ORIGINS` to the public web origin
- if production is same-origin behind Nginx, rebuild the `web` image after changing `NEXT_PUBLIC_API_URL` because `NEXT_PUBLIC_*` values are baked in at build time
- for this deployment, use `https://capellaegy.com` as the public origin
- recommended production browser API value: `NEXT_PUBLIC_API_URL=/api`

## Recommended Production Values

For `capellaegy.com`, prefer:

```env
NEXT_PUBLIC_API_URL=/api
CORS_ALLOWED_ORIGINS=https://capellaegy.com
COOKIE_SECURE=true
```

This keeps browser requests same-origin while the reverse proxy forwards `/api/*` to the API container.

## Nginx Same-Origin API Proxy

Use this on the public web host so browser calls to `/api/...` are forwarded to the API container on `127.0.0.1:4020`.

```nginx
server {
    server_name capellaegy.com;

    location /api/ {
        proxy_pass http://127.0.0.1:4020/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Notes:

- `proxy_pass http://127.0.0.1:4020/;` with a trailing slash strips the `/api/` prefix before forwarding.
- after changing `NEXT_PUBLIC_API_URL`, rebuild the `web` image because the browser value is baked in at build time

## Local Docker Fresh DB Flow

Use this when your local Docker database has no valuable data.

Verify local Compose config:

```bash
docker compose --env-file .env.docker config
```

Build and start from a clean database:

```bash
docker compose --env-file .env.docker down -v
docker compose --env-file .env.docker build --no-cache
docker compose --env-file .env.docker up -d
```

Verify containers are running:

```bash
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs migrate --tail 80
docker compose --env-file .env.docker logs api --tail 80
docker compose --env-file .env.docker logs web --tail 80
```

Verify local services:

```bash
curl http://localhost:4020/health
curl -I http://localhost:3020
```

## Local Docker Existing DB Flow

Use this when you want to keep your local Docker database volume.

```bash
docker compose --env-file .env.docker config
docker compose --env-file .env.docker build --no-cache
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs migrate --tail 80
docker compose --env-file .env.docker logs api --tail 80
curl http://localhost:4020/health
curl -I http://localhost:3020
```

## Production Flow

Use the same Compose file with a different env file:

```bash
docker compose --env-file .env.production config
docker compose --env-file .env.production build --no-cache
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs migrate --tail 80
docker compose --env-file .env.production logs api --tail 80
docker compose --env-file .env.production logs web --tail 80
```

If your VPS database has no valuable data and you want a clean reset:

```bash
docker compose --env-file .env.production down -v
docker compose --env-file .env.production up -d --build
```

Recommended public checks for this domain:

```bash
curl https://capellaegy.com/api/health
curl -I https://capellaegy.com
```

## Local Non-Docker Development

Use this when MySQL is running on your host machine and `.env` points to it.

```bash
pnpm --filter @capella/api db:migrate
pnpm dev
```

Verify local non-Docker services:

```bash
curl http://localhost:4000/health
```

## Common Commands

Build one service:

```bash
docker compose --env-file .env.production build api
docker compose --env-file .env.production build web
```

Rebuild and restart the full stack:

```bash
docker compose --env-file .env.production up -d --build
```

Stop without deleting data:

```bash
docker compose --env-file .env.production down
```

Stop and delete Docker volumes:

```bash
docker compose --env-file .env.production down -v
```

Restart services:

```bash
docker compose --env-file .env.production restart api web
docker compose --env-file .env.production restart api
docker compose --env-file .env.production restart web
```

Show running containers:

```bash
docker compose --env-file .env.production ps
```

For local Docker, replace `.env.production` with `.env.docker`.

## Logs

All logs:

```bash
docker compose --env-file .env.production logs
```

Tail all logs:

```bash
docker compose --env-file .env.production logs --tail 100
```

Service logs:

```bash
docker compose --env-file .env.production logs api --tail 80
docker compose --env-file .env.production logs web --tail 80
docker compose --env-file .env.production logs db --tail 80
docker compose --env-file .env.production logs migrate --tail 80
```

For local Docker, replace `.env.production` with `.env.docker`.

## Database Checks

Open MySQL with the app user:

```bash
docker compose --env-file .env.production exec db sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
```

Check whether a table exists:

```bash
docker compose --env-file .env.production exec db sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SHOW TABLES;"'
```

List migration files inside the API image workspace:

```bash
docker compose --env-file .env.production exec api sh -lc "ls -1 /app/apps/api/drizzle"
```

For local Docker, replace `.env.production` with `.env.docker`.

## URLs

Production:

- Web: `https://capellaegy.com`
- API: `https://capellaegy.com/api`
- API health: `https://capellaegy.com/api/health`

Local Docker:

- Web: `http://localhost:3020`
- API: `http://localhost:4020`
- API health: `http://localhost:4020/health`

Local non-Docker:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- API health: `http://localhost:4000/health`

## Rules

- This repo uses `db:migrate` for Dockerized environments. The `migrate` service runs before `api` starts.
- `down -v` deletes Docker volumes, including MySQL data.
- `docker-compose.yml` reads deployment values from the `--env-file` argument.
- Inside Docker, services talk to each other by service name such as `db`, not `localhost`.
- `NEXT_PUBLIC_API_URL` is for browser calls. It must be reachable by the browser.
- in production on `capellaegy.com`, prefer `NEXT_PUBLIC_API_URL=/api` behind a reverse proxy
- If you change `NEXT_PUBLIC_API_URL`, rebuild the `web` image.
