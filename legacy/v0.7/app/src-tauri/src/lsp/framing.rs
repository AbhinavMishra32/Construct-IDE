use serde_json::Value;

const HEADER_SEPARATOR: &[u8] = b"\r\n\r\n";

pub fn encode(message: &Value) -> Vec<u8> {
    let body = serde_json::to_vec(message).unwrap_or_else(|_| b"null".to_vec());
    let mut frame = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    frame.extend(body);
    frame
}

pub fn drain(buffer: &mut Vec<u8>) -> Vec<Value> {
    let mut messages = Vec::new();
    loop {
        let Some(header_end) = find_bytes(buffer, HEADER_SEPARATOR) else {
            break;
        };
        let header = String::from_utf8_lossy(&buffer[..header_end]);
        let length = header.lines().find_map(|line| {
            line.strip_prefix("Content-Length:")
                .and_then(|value| value.trim().parse::<usize>().ok())
        });
        let Some(length) = length else {
            buffer.clear();
            break;
        };
        let body_start = header_end + HEADER_SEPARATOR.len();
        if buffer.len() < body_start + length {
            break;
        }
        let body = buffer[body_start..body_start + length].to_vec();
        buffer.drain(..body_start + length);
        if let Ok(message) = serde_json::from_slice(&body) {
            messages.push(message);
        }
    }
    messages
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drains_split_and_unicode_frames_by_byte_length() {
        let message = serde_json::json!({"id": 1, "result": "héllo"});
        let frame = encode(&message);
        let split = frame.len() - 3;
        let mut buffer = frame[..split].to_vec();
        assert!(drain(&mut buffer).is_empty());
        buffer.extend_from_slice(&frame[split..]);
        assert_eq!(drain(&mut buffer), vec![message]);
    }
}
