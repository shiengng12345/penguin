use serde::Serialize;

pub const VALUE_PREVIEW_BYTES: usize = 4096; // 4 KB truncation threshold

pub fn truncate_utf8_preview(value: &str) -> (String, bool, usize) {
    let total_bytes = value.len();
    if total_bytes <= VALUE_PREVIEW_BYTES {
        return (value.to_string(), false, total_bytes);
    }

    let mut end = VALUE_PREVIEW_BYTES;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_string(), true, total_bytes)
}

#[derive(Debug, Serialize)]
pub struct StringValue {
    pub value: String,
    pub truncated: bool,
    pub total_bytes: usize,
}

#[derive(Debug, Serialize)]
pub struct HashField {
    pub field: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
pub struct HashPage {
    pub fields: Vec<HashField>,
    pub total: i64,
    pub next_cursor: u64,
}

#[derive(Debug, Serialize)]
pub struct ListPage {
    pub items: Vec<String>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct SetPage {
    pub members: Vec<String>,
    pub next_cursor: u64,
}

#[derive(Debug, Serialize)]
pub struct ZSetEntry {
    pub member: String,
    pub score: f64,
}

#[derive(Debug, Serialize)]
pub struct ZSetPage {
    pub entries: Vec<ZSetEntry>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct ScanPage {
    pub keys: Vec<String>,
    pub next_cursor: u64,
    pub done: bool,
}

// Redis Insight-style enriched key row: type + TTL + memory size, all
// fetched in one pipelined round trip after the SCAN page returns.
#[derive(Debug, Serialize)]
pub struct EnrichedKey {
    pub key: String,
    pub key_type: String, // "string" | "hash" | "list" | "set" | "zset" | "stream" | "none"
    pub ttl: i64,         // -1 no expiry, -2 gone, >0 seconds
    pub size_bytes: i64,  // MEMORY USAGE; -1 when unavailable
}

#[derive(Debug, Serialize)]
pub struct EnrichedScanPage {
    pub keys: Vec<EnrichedKey>,
    pub next_cursor: u64,
    pub done: bool,
    pub scanned: usize, // how many keys this SCAN iteration returned (pre-enrich)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn string_preview_truncates_at_utf8_boundary() {
        let mut value = "a".repeat(VALUE_PREVIEW_BYTES - 1);
        value.push('界');

        let (preview, truncated, total_bytes) = truncate_utf8_preview(&value);

        assert!(truncated);
        assert_eq!(total_bytes, VALUE_PREVIEW_BYTES + 2);
        assert_eq!(preview.len(), VALUE_PREVIEW_BYTES - 1);
        assert!(preview.is_char_boundary(preview.len()));
    }

    #[test]
    fn string_preview_keeps_short_values_complete() {
        let value = "hello 世界";

        let (preview, truncated, total_bytes) = truncate_utf8_preview(value);

        assert!(!truncated);
        assert_eq!(total_bytes, value.len());
        assert_eq!(preview, value);
    }
}
