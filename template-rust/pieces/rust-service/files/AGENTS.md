# Rust service

HTTP service in the root Cargo workspace; the binary is named like the crate directory.

- Config is env vars read once at boot (`src/config.rs`): `PORT` (8080). Tests pass a lookup
  closure; never set process env (`set_var` is unsafe in edition 2024, the workspace forbids unsafe).
- `src/app.rs` builds the `Router`; tests call it in-process with `tower::ServiceExt::oneshot`.
- `GET /healthz` returns 200 `ok`; Fly and load balancers probe it.
- Shutdown on SIGTERM/SIGINT is graceful (`src/main.rs`); keep handlers short.
- Behind Fly, the client address is `Fly-Client-IP`; read it only through `client_ip::fly_client_ip`
  (the header is spoofable anywhere else).
- Logs never include query strings, headers, bodies or secrets.
- Network code uses rustls; the root `deny.toml` bans openssl and native-tls.
- Pin dependencies `=x.y.z`; shared crates must equal `pins.toml` `[crates]`.
- With the `sqlite` piece, `src/main.rs` opens the database. Added later with `splice add sqlite`? Wire
  it by hand: `docs/sqlite.md`.
- Run one crate with `-p <crate>`, always `--locked`.
