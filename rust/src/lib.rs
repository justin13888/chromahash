/// ChromaHash: modern, high-quality image placeholder representation.
pub struct ChromaHash;

impl ChromaHash {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ChromaHash {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let _h = ChromaHash::new();
    }
}
