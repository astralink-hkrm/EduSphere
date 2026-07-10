// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::io::{Read, Write};

static UDISE_TRIGGER: AtomicBool = AtomicBool::new(false);

fn start_udise_bridge_server() {
    std::thread::spawn(|| {
        let listener = match std::net::TcpListener::bind("127.0.0.1:9876") {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[EduSphere] Failed to bind bridge server: {e}");
                return;
            }
        };
        listener.set_nonblocking(true).ok();
        println!("[EduSphere] Bridge server started on 127.0.0.1:9876");

        for stream in listener.incoming() {
            match stream {
                Ok(mut stream) => {
                    let mut buf = [0; 4096];
                    if let Ok(n) = stream.read(&mut buf) {
                        let request = String::from_utf8_lossy(&buf[..n]);
                        println!("[EduSphere] Poll request received from extension");

                        let triggered = UDISE_TRIGGER.swap(false, Ordering::SeqCst);

                        let (status, body) = if request.contains("GET /poll") {
                            if triggered {
                                println!("[EduSphere] Sending OPEN_UDISE response");
                                ("200 OK", r#"{"action":"OPEN_UDISE"}"#)
                            } else {
                                ("200 OK", r#"{"action":null}"#)
                            }
                        } else {
                            ("404 Not Found", "Not Found")
                        };

                        let response = format!(
                            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
                            body.len(), body
                        );
                        stream.write_all(response.as_bytes()).ok();
                    }
                }
                Err(_) => {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        }
    });
}

#[tauri::command]
async fn send_hf_request(
    url: String,
    token: String,
    model: String,
    image_base64: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    
    let payload = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": { "url": format!("data:image/jpeg;base64,{}", image_base64) }
                    },
                    {
                        "type": "text",
                        "text": "Extract all text from this government document image. Maintain structural reading layout and correct spelling."
                    }
                ]
            }
        ],
        "max_tokens": 512
    });

    println!("Sending request to: {}", url);
    let resp = match client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await {
            Ok(r) => r,
            Err(e) => {
                println!("Reqwest send failed. Detailed error: {:?}", e);
                return Err(format!("Failed to send request: {}", e));
            }
        };

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;

    if !status.is_success() {
        println!("HF API returned error status: {}. Body: {}", status, text);
        return Err(format!(
            "Hugging Face API returned error (Status {}): {}",
            status.as_u16(),
            text
        ));
    }

    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;

    let content = parsed["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "Could not find choices[0].message.content in HF response".to_string())?;

    Ok(content.to_string())
}

#[tauri::command]
fn trigger_udise_extension() {
    println!("[EduSphere] UDISE+ extension trigger received");
    UDISE_TRIGGER.store(true, Ordering::SeqCst);
}

fn main() {
    start_udise_bridge_server();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![send_hf_request, trigger_udise_extension])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
