//! Snapshot upload to S3-compatible storage (Cloudflare R2): SigV4 by hand over rustls (ring).
//! Only built with feature `s3-backup`. Errors never include response bodies or credentials.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use hmac::{Hmac, KeyInit, Mac};
use http_body_util::Full;
use hyper::body::Bytes;
use hyper_util::rt::TokioIo;
use rustls::pki_types::ServerName;
use rustls::{ClientConfig, RootCertStore};
use sha2::{Digest, Sha256};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;

use super::backup::utc_stamp;

/// Upload target, read from `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
/// and the optional `BACKUP_S3_REGION` (default `auto`, what R2 expects) and
/// `BACKUP_S3_TIMEOUT_SECS`. `R2_ENDPOINT` is `https://<host>` with no port or path.
#[derive(Clone, PartialEq, Eq)]
pub struct S3Config {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    /// Limit for the whole upload (`BACKUP_S3_TIMEOUT_SECS`, default 300, at least 1).
    pub timeout_secs: u64,
}

// Hand-written so a stray `{:?}` never prints the secret.
impl std::fmt::Debug for S3Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("S3Config")
            .field("endpoint", &self.endpoint)
            .field("bucket", &self.bucket)
            .field("region", &self.region)
            .field("timeout_secs", &self.timeout_secs)
            .finish_non_exhaustive()
    }
}

impl S3Config {
    /// `None` when no `R2_*` variable is set; an error naming the missing ones when only some are.
    pub fn from_lookup(lookup: &impl Fn(&str) -> Option<String>) -> Result<Option<Self>, String> {
        const KEYS: [&str; 4] = [
            "R2_ENDPOINT",
            "R2_BUCKET",
            "R2_ACCESS_KEY_ID",
            "R2_SECRET_ACCESS_KEY",
        ];
        let values: Vec<Option<String>> = KEYS.iter().map(|k| lookup(k)).collect();
        if values.iter().all(Option::is_none) {
            return Ok(None);
        }
        let missing: Vec<&str> = KEYS
            .iter()
            .zip(&values)
            .filter(|(_, v)| v.is_none())
            .map(|(k, _)| *k)
            .collect();
        if !missing.is_empty() {
            return Err(format!(
                "set all R2_* variables or none; missing {}",
                missing.join(", ")
            ));
        }
        let [endpoint, bucket, access_key_id, secret_access_key] =
            <[String; 4]>::try_from(values.into_iter().flatten().collect::<Vec<_>>())
                .map_err(|_| "R2_* variables".to_owned())?;
        check_endpoint(&endpoint)?;
        let timeout_secs =
            match lookup("BACKUP_S3_TIMEOUT_SECS") {
                None => 300,
                Some(v) => v.parse::<u64>().ok().filter(|n| *n > 0).ok_or_else(|| {
                    format!("BACKUP_S3_TIMEOUT_SECS must be at least 1, got {v:?}")
                })?,
            };
        Ok(Some(Self {
            endpoint,
            bucket,
            region: lookup("BACKUP_S3_REGION").unwrap_or_else(|| "auto".to_owned()),
            access_key_id,
            secret_access_key,
            timeout_secs,
        }))
    }
}

/// The endpoint must be `https://<host>`: uploads always go to port 443 and the host is signed.
fn check_endpoint(endpoint: &str) -> Result<(), String> {
    let host = endpoint.strip_prefix("https://").unwrap_or("");
    let ok = !host.is_empty()
        && !host.contains(['/', ':', '?', '#', '@'])
        && !host.chars().any(char::is_whitespace);
    if ok {
        Ok(())
    } else {
        Err("R2_ENDPOINT must be https://<host>, with no port, path or http".to_owned())
    }
}

/// Lowercase hex of the SHA-256 of `data`.
pub fn sha256_hex(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac =
        <Hmac<Sha256> as KeyInit>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// The SigV4 `Authorization` header value. `headers` are lowercase `(name, value)` pairs sorted by
/// name and must include `host`, `x-amz-content-sha256` and `x-amz-date`; `amz_date` is
/// `YYYYMMDDTHHMMSSZ`.
#[allow(clippy::too_many_arguments)]
pub fn authorization(
    method: &str,
    canonical_uri: &str,
    headers: &[(&str, &str)],
    payload_hash: &str,
    region: &str,
    access_key_id: &str,
    secret_access_key: &str,
    amz_date: &str,
) -> String {
    let date = &amz_date[..8];
    let canonical_headers: String = headers
        .iter()
        .map(|(k, v)| format!("{k}:{}\n", v.trim()))
        .collect();
    let signed_headers = headers
        .iter()
        .map(|(k, _)| *k)
        .collect::<Vec<_>>()
        .join(";");
    let request = format!(
        "{method}\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    );
    let scope = format!("{date}/{region}/s3/aws4_request");
    let to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        sha256_hex(request.as_bytes())
    );
    let k_date = hmac(
        format!("AWS4{secret_access_key}").as_bytes(),
        date.as_bytes(),
    );
    let k_region = hmac(&k_date, region.as_bytes());
    let k_service = hmac(&k_region, b"s3");
    let k_signing = hmac(&k_service, b"aws4_request");
    let signature = hex(&hmac(&k_signing, to_sign.as_bytes()));
    format!(
        "AWS4-HMAC-SHA256 Credential={access_key_id}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    )
}

/// PUTs `file` to `<endpoint>/<bucket>/backups/<file name>`, giving up after `timeout_secs`.
pub async fn upload(config: &S3Config, file: &Path) -> Result<(), String> {
    with_timeout(
        Duration::from_secs(config.timeout_secs),
        upload_inner(config, file),
    )
    .await
}

/// Runs `work`, turning a timeout into an error (which carries no secrets).
async fn with_timeout(
    limit: Duration,
    work: impl Future<Output = Result<(), String>>,
) -> Result<(), String> {
    tokio::time::timeout(limit, work)
        .await
        .unwrap_or_else(|_| Err(format!("upload timed out after {}s", limit.as_secs())))
}

async fn upload_inner(config: &S3Config, file: &Path) -> Result<(), String> {
    let name = file
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("bad snapshot name")?;
    let path = file.to_owned();
    // The whole snapshot is read into memory (to hash and send it in one request): fine up to a few
    // hundred MB. Past that, stream it with a multipart upload instead (see docs/restore.md).
    let body = tokio::task::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|e| format!("read task failed: {e}"))?
        .map_err(|e| format!("cannot read snapshot: {e}"))?;
    let host = config
        .endpoint
        .strip_prefix("https://")
        .ok_or("R2_ENDPOINT must start with https://")?
        .trim_end_matches('/');
    let uri = format!("/{}/backups/{name}", config.bucket);
    let payload_hash = sha256_hex(&body);
    let amz_date = utc_stamp();
    let auth = authorization(
        "PUT",
        &uri,
        &[
            ("host", host),
            ("x-amz-content-sha256", &payload_hash),
            ("x-amz-date", &amz_date),
        ],
        &payload_hash,
        &config.region,
        &config.access_key_id,
        &config.secret_access_key,
        &amz_date,
    );

    let mut roots = RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls =
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .map_err(|e| format!("tls setup failed: {e}"))?
            .with_root_certificates(roots)
            .with_no_client_auth();
    let tcp = TcpStream::connect((host, 443))
        .await
        .map_err(|e| format!("cannot connect to {host}: {e}"))?;
    let server_name =
        ServerName::try_from(host.to_owned()).map_err(|e| format!("bad host: {e}"))?;
    let stream = TlsConnector::from(Arc::new(tls))
        .connect(server_name, tcp)
        .await
        .map_err(|e| format!("tls handshake with {host} failed: {e}"))?;
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|e| format!("http handshake failed: {e}"))?;
    tokio::spawn(connection);
    let request = hyper::Request::builder()
        .method("PUT")
        .uri(&uri)
        .header("host", host)
        .header("x-amz-content-sha256", &payload_hash)
        .header("x-amz-date", &amz_date)
        .header("authorization", auth)
        .header("content-length", body.len())
        .body(Full::new(Bytes::from(body)))
        .map_err(|e| format!("bad request: {e}"))?;
    let response = sender
        .send_request(request)
        .await
        .map_err(|e| format!("upload failed: {e}"))?;
    let status = response.status();
    if status.is_success() {
        Ok(())
    } else {
        Err(format!("upload rejected with status {status}"))
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{S3Config, authorization, sha256_hex, with_timeout};

    // AWS documentation, "Signature Calculations for the Authorization Header", GET Object example.
    #[test]
    fn sigv4_matches_the_aws_documentation_vector() {
        let empty = sha256_hex(b"");
        assert_eq!(
            empty,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        let auth = authorization(
            "GET",
            "/test.txt",
            &[
                ("host", "examplebucket.s3.amazonaws.com"),
                ("range", "bytes=0-9"),
                ("x-amz-content-sha256", &empty),
                ("x-amz-date", "20130524T000000Z"),
            ],
            &empty,
            "us-east-1",
            "AKIAIOSFODNN7EXAMPLE",
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            "20130524T000000Z",
        );
        assert_eq!(
            auth,
            "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, \
             SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, \
             Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        );
    }

    fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| {
            pairs
                .iter()
                .find(|(n, _)| *n == k)
                .map(|(_, v)| (*v).to_owned())
        }
    }

    #[test]
    fn config_is_all_or_nothing_and_region_defaults_to_auto() {
        assert_eq!(S3Config::from_lookup(&env(&[])).unwrap(), None);
        let err = S3Config::from_lookup(&env(&[("R2_BUCKET", "b")])).unwrap_err();
        assert!(
            err.contains("R2_ENDPOINT") && err.contains("R2_SECRET_ACCESS_KEY"),
            "{err}"
        );
        let all = [
            ("R2_ENDPOINT", "https://a.r2.cloudflarestorage.com"),
            ("R2_BUCKET", "b"),
            ("R2_ACCESS_KEY_ID", "id"),
            ("R2_SECRET_ACCESS_KEY", "shh"),
        ];
        let c = S3Config::from_lookup(&env(&all)).unwrap().unwrap();
        assert_eq!(c.region, "auto");
        assert_eq!(c.timeout_secs, 300);
        assert!(!format!("{c:?}").contains("shh"));
    }

    #[test]
    fn endpoint_must_be_plain_https_host() {
        let with = |endpoint: &str| {
            let all = [
                ("R2_ENDPOINT", endpoint),
                ("R2_BUCKET", "b"),
                ("R2_ACCESS_KEY_ID", "id"),
                ("R2_SECRET_ACCESS_KEY", "shh"),
            ];
            S3Config::from_lookup(&env(&all))
        };
        assert!(with("https://a.r2.cloudflarestorage.com").is_ok());
        for bad in [
            "http://a.example.com",
            "https://a.example.com:8443",
            "https://a.example.com/bucket",
            "https://a.example.com/",
            "https://",
            "a.example.com",
        ] {
            let err = with(bad).unwrap_err();
            assert!(err.contains("R2_ENDPOINT must be https://"), "{bad}: {err}");
        }
    }

    #[test]
    fn timeout_secs_is_read_and_at_least_one() {
        let base = [
            ("R2_ENDPOINT", "https://a.example.com"),
            ("R2_BUCKET", "b"),
            ("R2_ACCESS_KEY_ID", "id"),
            ("R2_SECRET_ACCESS_KEY", "shh"),
        ];
        let with = |t: &'static str| {
            let mut all = base.to_vec();
            all.push(("BACKUP_S3_TIMEOUT_SECS", t));
            S3Config::from_lookup(&env(&all))
        };
        assert_eq!(with("30").unwrap().unwrap().timeout_secs, 30);
        assert!(with("0").unwrap_err().contains("BACKUP_S3_TIMEOUT_SECS"));
        assert!(with("soon").unwrap_err().contains("BACKUP_S3_TIMEOUT_SECS"));
    }

    #[tokio::test]
    async fn a_stalled_upload_times_out_with_an_error() {
        let err = with_timeout(Duration::from_millis(50), std::future::pending())
            .await
            .unwrap_err();
        assert!(err.contains("timed out"), "{err}");
        assert!(
            with_timeout(Duration::from_secs(5), async { Ok(()) })
                .await
                .is_ok()
        );
    }
}
