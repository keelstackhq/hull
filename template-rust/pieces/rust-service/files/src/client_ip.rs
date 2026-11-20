//! The one place that trusts a client-address header.

use std::net::IpAddr;

use axum::http::HeaderMap;

/// Returns the client address Fly's edge proxy reports in `Fly-Client-IP`.
///
/// Fly overwrites this header on every request, so it is trustworthy only when the service is
/// reached through Fly's proxy. Anywhere else a client can forge it: do not read client
/// addresses from headers outside this function.
#[must_use]
#[allow(dead_code)] // a helper for handlers; the health endpoint does not need it
pub fn fly_client_ip(headers: &HeaderMap) -> Option<IpAddr> {
    headers
        .get("fly-client-ip")?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderMap;

    use super::fly_client_ip;

    #[test]
    fn reads_a_valid_address() {
        let mut headers = HeaderMap::new();
        headers.insert("fly-client-ip", "203.0.113.7".parse().unwrap());
        assert_eq!(
            fly_client_ip(&headers),
            Some("203.0.113.7".parse().unwrap())
        );
    }

    #[test]
    fn ignores_a_missing_or_malformed_header() {
        let mut headers = HeaderMap::new();
        assert_eq!(fly_client_ip(&headers), None);
        headers.insert("fly-client-ip", "not-an-ip".parse().unwrap());
        assert_eq!(fly_client_ip(&headers), None);
    }
}
