mod common;

use common::cli;
use insta::{assert_json_snapshot, assert_snapshot};
use predicates::prelude::*;
use serde_json::Value;

/// Parse stdout as exactly one JSON object followed by a single newline.
fn one_object(stdout: &[u8]) -> Value {
    let text = std::str::from_utf8(stdout).expect("stdout is UTF-8");
    assert!(text.ends_with('\n'), "stdout ends with a newline: {text:?}");
    assert_eq!(text.lines().count(), 1, "stdout is one line: {text:?}");
    let value: Value = serde_json::from_str(text).expect("stdout is JSON");
    assert!(value.is_object(), "stdout is an object: {text:?}");
    value
}

#[test]
fn help_lists_the_commands() {
    let out = cli().arg("--help").assert().success().get_output().clone();
    let help = String::from_utf8(out.stdout)
        .expect("help is UTF-8")
        .replace(env!("CARGO_PKG_NAME"), "[BIN]");
    assert_snapshot!(
        help,
        @r"
        A command line tool. Replace this text and the example command with your own

        Usage: [BIN] [OPTIONS] <COMMAND>

        Commands:
          hello        Print a greeting (the example command)
          completions  Print a shell completion script
          man          Print the man page (roff)
          help         Print this message or the help of the given subcommand(s)

        Options:
              --json        Print one JSON object on stdout instead of text
          -C <DIR>          Run as if started in DIR
          -v, --verbose...  More logs on stderr (repeat for more)
          -q, --quiet       Only errors on stderr
          -h, --help        Print help
          -V, --version     Print version
        "
    );
}

#[test]
fn hello_json_is_one_object() {
    let out = cli()
        .args(["hello", "--json"])
        .assert()
        .success()
        .get_output()
        .clone();
    assert_json_snapshot!(
        one_object(&out.stdout),
        @r#"
        {
          "command": "hello",
          "exit_code": 0,
          "greeting": "hello, world",
          "messages": [],
          "ok": true,
          "version": 1
        }
        "#
    );
}

#[test]
fn hello_takes_a_name() {
    cli()
        .args(["hello", "--name", "Ada"])
        .assert()
        .success()
        .stdout("hello, Ada\n");
}

#[test]
fn an_empty_name_is_a_usage_error_with_exit_2() {
    let out = cli()
        .args(["hello", "--name", "", "--json"])
        .assert()
        .code(2)
        .get_output()
        .clone();
    let value = one_object(&out.stdout);
    assert_eq!(value["ok"], false);
    assert_eq!(value["exit_code"], 2);
    assert_eq!(value["error"]["kind"], "usage");
}

#[test]
fn a_clap_error_with_json_is_one_object_and_exit_2() {
    let out = cli()
        .args(["--json", "--bogus"])
        .assert()
        .code(2)
        .get_output()
        .clone();
    let value = one_object(&out.stdout);
    assert_eq!(value["version"], 1);
    assert_eq!(value["ok"], false);
    assert_eq!(value["exit_code"], 2);
    assert_eq!(value["error"]["kind"], "usage");
}

#[test]
fn a_clap_error_without_json_goes_to_stderr_only() {
    cli()
        .arg("--bogus")
        .assert()
        .code(2)
        .stdout(predicate::str::is_empty())
        .stderr(predicate::str::contains("--bogus"));
}

#[test]
fn a_missing_directory_is_a_config_error_with_exit_3() {
    let out = cli()
        .args(["-C", "does-not-exist", "hello", "--json"])
        .assert()
        .code(3)
        .get_output()
        .clone();
    let value = one_object(&out.stdout);
    assert_eq!(value["exit_code"], 3);
    assert_eq!(value["error"]["kind"], "config");
}

#[test]
fn help_exits_0() {
    cli().arg("--help").assert().code(0);
}

#[test]
fn hello_without_json_writes_nothing_to_stderr() {
    cli()
        .arg("hello")
        .assert()
        .success()
        .stderr(predicate::str::is_empty());
}

#[test]
fn completions_and_man_print_something() {
    cli()
        .args(["completions", "bash"])
        .assert()
        .success()
        .stdout(predicate::str::is_empty().not());
    cli()
        .arg("man")
        .assert()
        .success()
        .stdout(predicate::str::is_empty().not());
}

#[test]
fn trace_logs_go_to_stderr_and_stdout_stays_one_object() {
    let out = cli()
        .args(["hello", "--json"])
        .env("RUST_LOG", "trace")
        .assert()
        .success()
        .stderr(predicate::str::contains("running"))
        .get_output()
        .clone();
    one_object(&out.stdout);
}

#[test]
fn the_test_command_starts_from_an_empty_env_with_exactly_these_vars() {
    let cli = cli();
    // `env_clear()` shows up in the command's Debug output as `env -i`.
    assert!(
        format!("{:?}", *cli).contains("env -i"),
        "common::cli() must call env_clear(): {:?}",
        *cli
    );
    let mut keys: Vec<String> = Vec::new();
    for (key, value) in cli.get_envs() {
        let value = value.unwrap_or_else(|| panic!("{key:?} is removed instead of set"));
        if key == "NO_COLOR" {
            assert_eq!(value, "1");
        }
        keys.push(key.to_string_lossy().into_owned());
    }
    keys.sort();
    let mut expected = vec![
        "HOME",
        "NO_COLOR",
        "XDG_CACHE_HOME",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_STATE_HOME",
    ];
    if std::env::var_os("PATH").is_some() {
        expected.push("PATH");
    }
    expected.sort_unstable();
    assert_eq!(
        keys, expected,
        "no token or other variable reaches the command"
    );
}
