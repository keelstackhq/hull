//! Code shared by the crates of this workspace.

/// Returns the greeting for `name`.
///
/// ```
/// assert_eq!(common::greeting("world"), "hello, world");
/// ```
#[must_use]
pub fn greeting(name: &str) -> String {
    format!("hello, {name}")
}

#[cfg(test)]
mod tests {
    use super::greeting;

    #[test]
    fn greets_by_name() {
        assert_eq!(greeting("rust"), "hello, rust");
    }
}
