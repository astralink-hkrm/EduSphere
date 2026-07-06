"use client";
import React, { useState, useEffect } from "react";

export default function Settings() {
  const [geminiKey, setGeminiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setGeminiKey(localStorage.getItem("gemini_key") || "");
    setGroqKey(localStorage.getItem("groq_key") || "");
  }, []);

  const save = () => {
    localStorage.setItem("gemini_key", geminiKey);
    localStorage.setItem("groq_key", groqKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 600, margin: "0 0 4px 0" }}>Settings</h1>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: "0 0 20px 0" }}>
        Configure API keys for vision models
      </p>

      <div className="card" style={{ marginBottom: "16px" }}>
        <div className="card-header">
          <span className="card-title">Google Gemini</span>
        </div>
        <div style={{ padding: "0 0 12px 0" }}>
          <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
            API Key
          </label>
          <input type="password" className="input" value={geminiKey}
            onChange={e => setGeminiKey(e.target.value)}
            placeholder="Enter your Gemini API key" />
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "4px" }}>
            Get your key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>aistudio.google.com</a>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "16px" }}>
        <div className="card-header">
          <span className="card-title">Groq (Llama 4 Scout Vision)</span>
        </div>
        <div style={{ padding: "0 0 12px 0" }}>
          <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
            API Key
          </label>
          <input type="password" className="input" value={groqKey}
            onChange={e => setGroqKey(e.target.value)}
            placeholder="Enter your Groq API key" />
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "4px" }}>
            Get your key at <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>console.groq.com</a>
          </div>
        </div>
      </div>

      <button className="btn btn-primary" onClick={save}>
        {saved ? "✓ Saved" : "Save Keys"}
      </button>
    </div>
  );
}
