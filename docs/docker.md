# Production Docker deployment

This project uses Docker only for production on the Hostinger KVM 1 VPS. Nginx and TLS remain installed on the host. Docker exposes the selected frontend containers and API only on localhost; MySQL is available only inside the Docker network.

## Services and ports

| Service | Container port | Host binding | Public route |
| --- | ---: | --- | --- |
| HR / attendance Web | 3000 | `127.0.0.1:3020` | `https://capellaegy.com` |
| POS | 3000 | `127.0.0.1:3021` | `https://pos.capellaegy.com` |
| API | 4000 | `127.0.0.1:4020` | `/api/v1` on both frontend hosts |
| Worker | None | None | None |
| MySQL | 3306 | None | None |

The Compose project name remains `capellahr`, so its container names continue to use the `capellahr-` prefix. The new database and employee-upload volumes end in `_v2` to prevent the old beta data from being reused accidentally.

MySQL enables `log_bin_trust_function_creators` because migrations create application-owned validation triggers through the restricted database account. The account still requires its normal database privileges; this setting does not grant access by itself.

## Production environment

Create the untracked root `.env.production` on the VPS and restrict it to the owner:

```bash
cp .env.example .env.production
chmod 600 .env.production
```

Set at least the following production values:

```dotenv
NODE_ENV=production
EDITION=full
COMPOSE_PROFILES=full
WEB_PORT=3000
API_PORT=4000
MYSQL_DATABASE=capella_hr
MYSQL_USER=capella_hr
MYSQL_PASSWORD=replace_with_a_long_random_database_password
MYSQL_ROOT_PASSWORD=replace_with_a_different_long_random_root_password
DATABASE_URL=mysql://capella_hr:replace_with_a_long_random_database_password@db:3306/capella_hr

LOG_LEVEL=info
APP_TIME_ZONE=Africa/Cairo
APP_LOCALE=ar-EG-u-nu-latn
MAX_EMPLOYEE_IMAGE_BYTES=16777216
TRUST_PROXY_HOPS=1
PUBLIC_ORIGINS=https://capellaegy.com,https://pos.capellaegy.com
DEV_CORS_ORIGINS=
ADMIN_EMAIL=replace_with_the_admin_email
ADMIN_PASSWORD=replace_with_a_long_random_admin_password
PROTECTED_TAB_PASSWORD=replace_with_a_long_random_protected_tab_password
```

`EDITION` must be exactly `hr`, `erp`, or `full`. Capella uses `full`. The API and worker resolve the same edition registry, while migrations remain edition-independent and always apply the complete schema history.

| Edition | Compose profile | Frontends | Background capabilities |
| --- | --- | --- | --- |
| HR | `hr` | HR Web | Attendance, Payroll, and HR reports |
| ERP | `erp` | Restricted attendance Web and POS | Attendance without Payroll, plus ERP reports |
| Full | `full` | HR Web and POS | Combined HR and ERP processing |

Set `COMPOSE_PROFILES` to the same single value as `EDITION`. Compose uses it to select services, and API/worker startup rejects a mismatch rather than silently exposing a partial product. Do not add `--profile`; change both environment values together when deploying a different sellable edition.
The commands below target Capella's `full` installation. For HR, set both values to `hr` and omit `pos`. For ERP, set both to `erp` and keep both `web` and `pos`: `web` serves only the attendance kiosk/device-pairing surface while HR administration, employee self-service, Payroll, and the other HR-only modules remain unavailable.

Use URL-safe characters in `MYSQL_PASSWORD`, or percent-encode special characters in `DATABASE_URL`. The edition and private `API_PROXY_TARGET=http://api:4000` are embedded during frontend builds, so changing either requires rebuilding the selected frontend images. Browser code never receives that private address; it always calls the current host's `/api/v1` path.

Set `PUBLIC_ORIGINS` to every canonical public origin served by this API. The origin guard matches each request host only to its configured canonical origin; it never trusts an arbitrary production `Host` header. Keep `DEV_CORS_ORIGINS` empty in production. When a local tool genuinely needs cross-origin credentialed requests, set it only under `NODE_ENV=development` to a comma-separated origin list such as `http://localhost:3000,http://localhost:3001`. Production startup rejects a non-empty list.

Validate interpolation without printing resolved secrets:

```bash
docker compose --env-file .env.production config --quiet
```

Do not paste the output of `docker compose --env-file .env.production config` into tickets or chat because the fully rendered output contains secrets.

## First replacement of the old beta HR stack

The commands in this section remove only the old `capellahr` deployment. They must not be used for the storefront or factory Compose projects.

Pull the code and build each image sequentially to reduce peak memory use on the 1-vCPU, 4-GB VPS:

```bash
git pull --ff-only
docker compose --env-file .env.production build api
docker compose --env-file .env.production build worker
docker compose --env-file .env.production build web
docker compose --env-file .env.production build pos
docker compose --env-file .env.production build migrate
```

The old containers continue running while the images build. If a build fails, fix it before beginning the maintenance window.

Before stopping the old stack, record its volume names:

```bash
docker inspect capellahr-db-1 --format '{{range .Mounts}}{{println .Name "->" .Destination}}{{end}}'
docker inspect capellahr-api-1 --format '{{range .Mounts}}{{println .Name "->" .Destination}}{{end}}'
```

Confirm that every recorded volume belongs to the old HR project. Then start the maintenance window:

```bash
docker compose --env-file .env.production down --remove-orphans
```

Remove the confirmed old HR volumes by their exact recorded names. Do not use a wildcard and do not remove volumes belonging to another project:

```bash
docker volume rm OLD_HR_MYSQL_VOLUME OLD_HR_UPLOAD_VOLUME
```

Start the clean database, run all committed Drizzle migrations, and then start the API and web services:

```bash
docker compose --env-file .env.production up -d db
docker compose --env-file .env.production up migrate
docker compose --env-file .env.production up -d api worker web pos
```

If migration fails, leave API, worker, and both frontends stopped and inspect the migration output. Do not bypass a failed migration.

## Normal manual deployment

Every later deployment remains manual; there is intentionally no deployment script.

Build while the current containers continue serving traffic:

```bash
git pull --ff-only
docker compose --env-file .env.production build api
docker compose --env-file .env.production build worker
docker compose --env-file .env.production build web
docker compose --env-file .env.production build pos
docker compose --env-file .env.production build migrate
```

Then use the short maintenance window to migrate and replace the application containers:

```bash
docker compose --env-file .env.production stop web pos worker api
docker compose --env-file .env.production up -d db
docker compose --env-file .env.production up migrate
docker compose --env-file .env.production up -d api worker web pos
```

The API initializes the configured admin account at startup. The repository's seed command is currently empty and is not part of deployment.

## Verification

Check Compose health and the localhost bindings:

```bash
docker compose --env-file .env.production ps
curl --fail http://127.0.0.1:4020/api/v1/health/live
curl --fail http://127.0.0.1:4020/api/v1/health/ready
curl --fail http://127.0.0.1:3020/
curl --fail http://127.0.0.1:3021/
```

Then verify the same routes through Nginx and TLS:

```bash
curl --fail https://capellaegy.com/api/v1/health/live
curl --fail https://capellaegy.com/api/v1/health/ready
curl --fail https://capellaegy.com/
curl --fail https://pos.capellaegy.com/api/v1/health/live
curl --fail https://pos.capellaegy.com/api/v1/health/ready
curl --fail https://pos.capellaegy.com/
```

Expected API health response:

```json
{"status":"ok"}
```

The liveness route checks the Node process. The readiness route executes `SELECT 1` against MySQL and returns HTTP 503 with `{"status":"unavailable"}` when the database cannot be reached. Both routes are intentionally public and expose no environment or database details.

## Nginx boundary

Use [the recommended subdomain example](../deploy/nginx/recommended-subdomains.conf.example) for normal installations. It serves HR—or the restricted attendance surface in ERP-only deployments—and POS on separate subdomains, and each server block routes its own `/api/` path to `127.0.0.1:4020`. For two unrelated public domains, use [the separate-domain example](../deploy/nginx/separate-domains.conf.example); the proxy behavior is intentionally identical. Replace the example hostnames and certificate paths, preserve Certbot's TLS settings, then validate with `nginx -t` before reloading Nginx.

The proxy must overwrite `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For` exactly as shown. `TRUST_PROXY_HOPS` is required when a deployment proxy terminates TLS; set it to the verified number of trusted hops (`1` for the documented local Nginx topology). Production same-origin checks select the matching canonical value from `PUBLIC_ORIGINS`, while Host-based origin derivation is development-only. Do not add an `Access-Control-Allow-Origin` header in Nginx. The API container remains bound only to `127.0.0.1:4020`, and both API locations retain `client_max_body_size 17m` so the proxy does not undercut the application upload limit.

## Production security verification

The session cookie must be `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and host-only (there must be no `Domain` attribute). Log into HR in a browser, open POS, and confirm POS still requires its own login. After logging into POS, logging out of either application must not log out the other. This independent behavior is required even though both hosts proxy to the same API and use the same cookie name.

Verify the production origin guard against both public hosts. A state-changing request without `Origin`, or with a foreign origin, must return `403` with `INVALID_ORIGIN`; the matching origin reaches the route normally:

```bash
curl -i -X POST https://capellaegy.com/api/v1/auth/logout
curl -i -X POST -H "Origin: https://attacker.example" https://capellaegy.com/api/v1/auth/logout
curl -i -X POST -H "Origin: https://capellaegy.com" https://capellaegy.com/api/v1/auth/logout
```

Repeat those three checks against `https://pos.capellaegy.com`. The first two responses must be `403`; the matching-origin logout returns `204`. In each frontend, also verify that a missing or expired session returns to login, a network failure shows the retry state, and a valid wrong-role or cross-application session shows the explicit access message without rendering protected content. The HR protected-area password route must likewise return `403 INVALID_ORIGIN` for a foreign origin.

## Operations

View status and logs:

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=200 api
docker compose --env-file .env.production logs --tail=200 web
docker compose --env-file .env.production logs --tail=200 pos
docker compose --env-file .env.production logs --tail=200 worker
docker compose --env-file .env.production logs --tail=200 db
docker compose --env-file .env.production logs --follow api
```

Restart a service without rebuilding it:

```bash
docker compose --env-file .env.production restart api
```

Stop the HR stack without deleting data:

```bash
docker compose --env-file .env.production down
```

After a successful deployment, remove only dangling images left by previous builds:

```bash
docker image prune --force
```

Do not add `--volumes` to routine shutdown or cleanup commands. The `capellahr_mysql_data_v2` and `capellahr_employee_uploads_v2` volumes contain production data and uploads.

Hostinger dashboard backups remain the operator's responsibility and are intentionally outside this Compose configuration.
