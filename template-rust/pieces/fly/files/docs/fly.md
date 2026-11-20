# Deploying to Fly.io

The service runs as one Fly machine with one volume (`/data`, SQLite files live there). The image
is `FROM scratch`: a static musl binary, user 65532, no shell. `Dockerfile` fails the build when the
binary has an `INTERP` header, `NEEDED` libraries, or is larger than `MAX_BYTES`.

## Setup (once)

1. `fly auth login`, `gh auth login`.
2. Create the GitHub environment `production` (Settings, Environments), restricted to the default
   branch. `FLY_API_TOKEN` lives there and nowhere else.
3. Run (preview first with `--dry-run`; a second run changes nothing):

   ```bash
   printf 'SECRET_NAME=value\n' | bash scripts/fly-setup.sh --app APP --region iad \
     --host api.example.com --secrets-stdin --set-gh-secret production
   ```

   Secret values go over stdin only (never argv, never logged). Exit codes: 0 ok, 2 usage, 3 missing
   tool or not logged in, 4 a step failed. `--deploy` also runs the first deploy.

4. Set `app` and `primary_region` in `fly.toml`; set `FEATURES` in `[build.args]` when the service
   needs cargo features (for example `s3-backup`).

## Volume ownership

The image runs as uid 65532 and a new Fly volume may mount root-owned. Then the service exits at
start with `DATA_DIR /data is not writable ... uid 65532`. Fix it once, before the first deploy (a
volume attaches to one machine, so stop or destroy an app machine that already holds it):

```bash
bash scripts/fly-setup.sh --app APP --region iad --fix-volume-owner
# the same by hand:
fly machine run alpine:3 --app APP --region iad --volume data:/data --rm chown -R 65532:65532 /data
```

The throwaway machine chowns `/data` and is removed (`--rm`). Verify the flags against
`fly machine run --help` for your flyctl version.

## Deploys

`deploy.yml` runs after `ci` succeeds on the default branch (or by hand) and deploys the tested sha
in environment `production`, then polls `/healthz` with `scripts/smoke.sh`. `image.yml` builds the
image on pull requests with no secrets and no push.

## DNS: Cloudflare grey cloud

Point the hostname at Fly with DNS-only records (grey cloud, not proxied). Fly issues and renews the
certificate itself with Let's Encrypt (the HTTP challenge needs to reach Fly) and Fly-Client-IP is
the client address the service trusts; behind Cloudflare's proxy the client address would be
Cloudflare's, and Fly could not validate the certificate.

## Rollback

```bash
fly releases --app APP --image          # find the previous image
fly deploy --app APP --image registry.fly.io/APP:deployment-XXXX
```

SQLite schema changes are forward-only: roll back only when the previous image reads the current
schema. Restore data from a backup otherwise.

## Building the image behind the agent proxy

Agent sandboxes re-sign TLS. Build with the proxy CA as build context:

```bash
bash scripts/proxy-ca.sh docker build -t APP .
```

Without a proxy this is a plain `docker build`.
