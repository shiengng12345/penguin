use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpProxyRequest {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub body_base64: Option<String>,
    #[serde(default)]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpProxyResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub body_base64: String,
    pub error: Option<String>,
}

// In-flight proxied requests, keyed by the caller-supplied request id. The
// frontend's AbortSignal fires http_proxy_abort, which drops the request
// mid-flight via tokio::select.
fn proxy_aborts() -> &'static std::sync::Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>> {
    static ABORTS: std::sync::OnceLock<
        std::sync::Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    > = std::sync::OnceLock::new();
    ABORTS.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

#[tauri::command]
pub(crate) fn http_proxy_abort(request_id: String) {
    if let Some(tx) = proxy_aborts().lock().unwrap().remove(&request_id) {
        let _ = tx.send(());
    }
}

#[tauri::command]
pub(crate) async fn http_proxy(req: HttpProxyRequest) -> HttpProxyResponse {
    let request_id = req.request_id.clone();
    let rx = request_id.as_ref().map(|id| {
        let (tx, rx) = tokio::sync::oneshot::channel();
        proxy_aborts().lock().unwrap().insert(id.clone(), tx);
        rx
    });

    let result = match rx {
        Some(rx) => tokio::select! {
            resp = http_proxy_inner(req) => resp,
            _ = rx => HttpProxyResponse {
                status: 0,
                headers: HashMap::new(),
                body: String::new(),
                body_base64: String::new(),
                error: Some("Request cancelled".to_string()),
            },
        },
        None => http_proxy_inner(req).await,
    };

    if let Some(id) = request_id {
        proxy_aborts().lock().unwrap().remove(&id);
    }
    result
}

async fn http_proxy_inner(req: HttpProxyRequest) -> HttpProxyResponse {
    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => {
            return HttpProxyResponse {
                status: 0,
                headers: HashMap::new(),
                body: String::new(),
                body_base64: String::new(),
                error: Some(e.to_string()),
            };
        }
    };

    let method = match req.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let mut request_builder = client.request(method, &req.url);

    for (k, v) in &req.headers {
        request_builder = request_builder.header(k, v);
    }

    let body: Option<Vec<u8>> = if let Some(ref b64) = req.body_base64 {
        match base64::engine::general_purpose::STANDARD.decode(b64) {
            Ok(b) => Some(b),
            Err(e) => {
                return HttpProxyResponse {
                    status: 0,
                    headers: HashMap::new(),
                    body: String::new(),
                    body_base64: String::new(),
                    error: Some(format!("Invalid base64 body: {}", e)),
                };
            }
        }
    } else if let Some(ref b) = req.body {
        Some(b.as_bytes().to_vec())
    } else {
        None
    };

    let request_builder = if let Some(b) = body {
        request_builder.body(b)
    } else {
        request_builder
    };

    let response = match request_builder.send().await {
        Ok(r) => r,
        Err(e) => {
            return HttpProxyResponse {
                status: 0,
                headers: HashMap::new(),
                body: String::new(),
                body_base64: String::new(),
                error: Some(e.to_string()),
            };
        }
    };

    let status = response.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in response.headers() {
        if let Ok(v_str) = v.to_str() {
            headers.insert(k.as_str().to_string(), v_str.to_string());
        }
    }

    let bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return HttpProxyResponse {
                status,
                headers,
                body: String::new(),
                body_base64: String::new(),
                error: Some(e.to_string()),
            };
        }
    };

    let body_str = String::from_utf8_lossy(&bytes).to_string();
    let body_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    HttpProxyResponse {
        status,
        headers,
        body: body_str,
        body_base64,
        error: None,
    }
}
