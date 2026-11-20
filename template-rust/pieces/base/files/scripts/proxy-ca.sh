#!/usr/bin/env bash
# Proxy-CA hook: lets `docker build` work behind an HTTPS proxy that re-signs TLS (the Claude Code
# cloud agent proxy). The CA bundle path comes from the env: PROXY_CA_BUNDLE, else SSL_CERT_FILE,
# CURL_CA_BUNDLE or NODE_EXTRA_CA_CERTS. No CA or no HTTPS_PROXY: a no-op (local machines, CI).
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
    active || exit 0
    if [ "$(id -u)" != 0 ]; then
      echo "proxy-ca: not root; skipping the system trust store" >&2
      exit 0
    fi
    if [ -d /usr/local/share/ca-certificates ] && command -v update-ca-certificates >/dev/null; then
      cp "$ca" /usr/local/share/ca-certificates/agent-proxy-ca.crt
      update-ca-certificates >/dev/null
      # The daemon reads the trust store at start: restart it when it runs under systemd.
      if command -v systemctl >/dev/null && systemctl is-active --quiet docker 2>/dev/null; then
        systemctl restart docker || echo "proxy-ca: restart docker to load the CA" >&2
      fi
    else
      echo "proxy-ca: no update-ca-certificates; add $ca to the system trust store by hand" >&2
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
