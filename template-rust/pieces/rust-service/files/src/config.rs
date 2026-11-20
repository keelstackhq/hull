//! Service configuration: environment variables, read once at boot.

use std::net::SocketAddr;

const DEFAULT_PORT: u16 = 8080;

/// Settings read from the environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// Port to listen on (`PORT`, default 8080).
    pub port: u16,
}

impl Config {
    /// Reads the process environment.
    pub fn from_env() -> Result<Self, String> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Reads settings through `lookup`, so tests never touch the process environment.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let port = match lookup("PORT") {
            None => DEFAULT_PORT,
            Some(v) => v
                .parse()
                .map_err(|_| format!("PORT must be a number from 0 to 65535, got {v:?}"))?,
        };
        Ok(Self { port })
    }

    /// Address to bind: all interfaces, so the platform proxy can reach it.
    #[must_use]
    pub fn bind_addr(&self) -> SocketAddr {
        SocketAddr::from(([0, 0, 0, 0], self.port))
    }
}

#[cfg(test)]
mod tests {
    use super::Config;

    #[test]
    fn port_defaults_to_8080() {
        let config = Config::from_lookup(|_| None).unwrap();
        assert_eq!(config.port, 8080);
        assert_eq!(config.bind_addr().to_string(), "0.0.0.0:8080");
    }

    #[test]
    fn port_is_read_from_the_lookup() {
        let config = Config::from_lookup(|k| (k == "PORT").then(|| "9090".to_owned())).unwrap();
        assert_eq!(config.port, 9090);
    }

    #[test]
    fn a_bad_port_says_what_to_fix() {
        let err = Config::from_lookup(|_| Some("eighty".to_owned())).unwrap_err();
        assert!(err.contains("PORT"), "{err}");
    }
}
