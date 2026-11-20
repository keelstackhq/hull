#!/usr/bin/env bash
# Proxy-CA hook: lets `docker build` work behind an HTTPS proxy that re-signs TLS (the Claude Code
# cloud agent proxy). No HTTPS_PROXY or no CA: a no-op (local machines, CI). `install` trusts only
# PROXY_CA_BUNDLE or the agent proxy's own bundle (/root/.ccr/ca-bundle.crt); `docker build` also
# takes SSL_CERT_FILE, CURL_CA_BUNDLE or NODE_EXTRA_CA_CERTS.
#   bash scripts/proxy-ca.sh install             as root (setup script, session start): trust the
#                                                CA system-wide so the docker daemon pulls images
#   bash scripts/proxy-ca.sh docker build ARGS   docker build with --network host, the proxy as
#                                                build args and the CA as build context `proxy-ca`
# The Dockerfile takes the CA from that context (empty without the proxy):
#   FROM scratch AS proxy-ca
#   FROM rust:1 AS build
#   COPY --from=proxy-ca / /usr/local/share/ca-certificates/
#   RUN update-ca-certificates
set -euo pipefail

ca="${PROXY_CA_BUNDLE:-${SSL_CERT_FILE:-${CURL_CA_BUNDLE:-${NODE_EXTRA_CA_CERTS:-}}}}"
proxy="${HTTPS_PROXY:-${https_proxy:-}}"
active() { [ -n "$proxy" ] && [ -n "$ca" ] && [ -f "$ca" ]; }

case "${1:-}" in
  install)
    agent="${PROXY_CA_AGENT:-/root/.ccr/ca-bundle.crt}"
    trust="${PROXY_CA_BUNDLE:-$agent}"
    [ -n "$proxy" ] && [ -f "$trust" ] || exit 0
    store="${PROXY_CA_STORE:-/usr/local/share/ca-certificates}"
    dest="$store/agent-proxy-ca.crt"
    if cmp -s "$trust" "$dest"; then
      echo "proxy-ca: CA unchanged"
      exit 0
    fi
    if ! [ -d "$store" ] || ! [ -w "$store" ]; then
      echo "proxy-ca: cannot write $store (not root?); skipping the system trust store" >&2
      exit 0
    fi
    cp "$trust" "$dest"
    # PROXY_CA_STORE and PROXY_CA_UPDATE are for tests; without an update command a test stops here.
    update="${PROXY_CA_UPDATE:-}"
    if [ -z "$update" ]; then
      [ -z "${PROXY_CA_STORE:-}" ] || exit 0
      if command -v update-ca-certificates >/dev/null; then update=update-ca-certificates; fi
    fi
    # On a failure the copy goes again, so the next run (cmp -s) retries instead of skipping.
    if [ -z "$update" ]; then
      rm -f "$dest"
      echo "proxy-ca: no update-ca-certificates; add $trust to the trust store by hand" >&2
      exit 0
    fi
    if ! "$update" >/dev/null; then
      rm -f "$dest"
      echo "proxy-ca: trust-store update failed; removed $dest so the next run retries" >&2
      exit 0
    fi
    # The daemon reads the trust store at start: restart it (only now that the CA changed).
    if [ -z "${PROXY_CA_STORE:-}" ] && command -v systemctl >/dev/null &&
      systemctl is-active --quiet docker 2>/dev/null; then
      systemctl restart docker || echo "proxy-ca: restart docker to load the CA" >&2
    fi
    ;;
  docker)
    shift
    [ "${1:-}" = build ] || { echo "proxy-ca: usage: proxy-ca.sh docker build ARGS" >&2; exit 2; }
    shift
    if ! active; then exec docker build "$@"; fi
    ctx="$(mktemp -d)"
    trap 'rm -rf "$ctx"' EXIT
    cp "$ca" "$ctx/agent-proxy-ca.crt"
    no="${NO_PROXY:-${no_proxy:-}}"
    docker build --network host --build-context "proxy-ca=$ctx" \
      --build-arg "HTTPS_PROXY=$proxy" --build-arg "https_proxy=$proxy" \
      --build-arg "HTTP_PROXY=${HTTP_PROXY:-$proxy}" --build-arg "NO_PROXY=$no" "$@"
    ;;
  *)
    echo "proxy-ca: usage: proxy-ca.sh install | docker build ARGS" >&2
    exit 2
    ;;
esac
