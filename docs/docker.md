# Production Docker deployment

This project uses Docker only for production on the Hostinger KVM 1 VPS. Nginx and TLS remain installed on the host. Docker exposes the web and API services only on localhost; MySQL is available only inside the Docker network.

## Services and ports

| Service | Container port | Host binding | Public route |
| --- | ---: | --- | --- |
| Web | 3000 | `127.0.0.1:3020` | `https://capellaegy.com` |
| API | 4000 | `127.0.0.1:4020` | `https://capellaegy.com/api/v1` |
| MySQL | 3306 | None | None |

The Compose project name remains `capellahr`, so its container names continue to use the `capellahr-` prefix. The new database and employee-upload volumes end in `_v2` to prevent the old beta data from being reused accidentally.

## Production environment

Create the untracked root `.env.production` on the VPS and restrict it to the owner:

```bash
cp .env.example .env.production
chmod 600 .env.production
```

Set at least the following production values:

```dotenv
NODE_ENV=production
WEB_PORT=3000
API_PORT=4000
NEXT_PUBLIC_API_URL=https://capellaegy.com/api/v1

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
WEB_ORIGIN=https://capellaegy.com
ADMIN_EMAIL=replace_with_the_admin_email
ADMIN_PASSWORD=replace_with_a_long_random_admin_password
```

Use URL-safe characters in `MYSQL_PASSWORD`, or percent-encode special characters in `DATABASE_URL`. `NEXT_PUBLIC_API_URL` is embedded during the web build, so changing it requires rebuilding the web image.

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
docker compose --env-file .env.production build web
docker compose --env-file .env.production --profile tools build migrate
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
docker compose --env-file .env.production --profile tools run --rm migrate
docker compose --env-file .env.production up -d api
docker compose --env-file .env.production up -d web
```

If migration fails, leave API and web stopped and inspect the migration output. Do not bypass a failed migration.

## Normal manual deployment

Every later deployment remains manual; there is intentionally no deployment script.

Build while the current containers continue serving traffic:

```bash
git pull --ff-only
docker compose --env-file .env.production build api
docker compose --env-file .env.production build web
docker compose --env-file .env.production --profile tools build migrate
```

Then use the short maintenance window to migrate and replace the application containers:

```bash
docker compose --env-file .env.production stop web api
docker compose --env-file .env.production up -d db
docker compose --env-file .env.production --profile tools run --rm migrate
docker compose --env-file .env.production up -d api
docker compose --env-file .env.production up -d web
```

The API initializes the configured admin account at startup. The repository's seed command is currently empty and is not part of deployment.

## Verification

Check Compose health and the localhost bindings:

```bash
docker compose --env-file .env.production ps
curl --fail http://127.0.0.1:4020/api/v1/health/live
curl --fail http://127.0.0.1:4020/api/v1/health/ready
curl --fail http://127.0.0.1:3020/
```

Then verify the same routes through Nginx and TLS:

```bash
curl --fail https://capellaegy.com/api/v1/health/live
curl --fail https://capellaegy.com/api/v1/health/ready
curl --fail https://capellaegy.com/
```

Expected API health response:

```json
{"status":"ok"}
```

The liveness route checks the Node process. The readiness route executes `SELECT 1` against MySQL and returns HTTP 503 with `{"status":"unavailable"}` when the database cannot be reached. Both routes are intentionally public and expose no environment or database details.

## Nginx boundary

The repository does not change the working host Nginx or Certbot configuration. It expects Nginx to keep proxying the root site to `127.0.0.1:3020` and `/api/` to `127.0.0.1:4020`, including the standard forwarded host, protocol, and client-address headers.

## Operations

View status and logs:

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=200 api
docker compose --env-file .env.production logs --tail=200 web
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
