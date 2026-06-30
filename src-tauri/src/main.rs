// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![send_hf_request])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
