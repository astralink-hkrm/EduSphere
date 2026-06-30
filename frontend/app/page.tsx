"use client";

import React, { useState, useEffect, useRef } from "react";
import { parseOCRResult } from "./parser";

// Safe Tauri API loader
let invoke: any = null;
let isTauriEnv = false;

if (typeof window !== "undefined") {
  const isTauri = (window as any).__TAURI_INTERNALS__ !== undefined;
  if (isTauri) {
    try {
      const core = require("@tauri-apps/api/core");
      invoke = core.invoke;
      isTauriEnv = true;
      console.log("Tauri environment detected.");
    } catch (e) {
      console.error("Failed to load Tauri APIs:", e);
    }
  }
}

export default function Home() {
  // Navigation State
  const [activeTab, setActiveTab] = useState<"dashboard" | "settings">("dashboard");

  // Model & Engine State
  const [hfToken, setHfToken] = useState("");
  const [hfTokenSet, setHfTokenSet] = useState(false);
  const [hfModel, setHfModel] = useState("Qwen/Qwen2.5-VL-7B-Instruct");

  // Batch Document State
  interface QueueFile {
    id: string;
    file: File;
    name: string;
    preview: string;
    status: "pending" | "processing" | "completed" | "failed";
    progress: number;
    resultText?: string;
    parsedData?: any;
    error?: string;
    elapsed?: number;
  }

  const [filesQueue, setFilesQueue] = useState<QueueFile[]>([]);
  const [activeQueueIndex, setActiveQueueIndex] = useState<number | null>(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [predictError, setPredictError] = useState("");
  const [progressLog, setProgressLog] = useState("");

  // Extracted Form State
  const [extractedForm, setExtractedForm] = useState({
    name: "",
    fathersName: "",
    dob: "",
    panNumber: "",
    aadhaarNumber: "",
    certificateId: "",
    address: "",
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  // Load saved token & engine configuration on start
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedToken = localStorage.getItem("hf_token") || "";
      if (savedToken) {
        setHfTokenSet(true);
      }
      const savedModel = localStorage.getItem("hf_model") || "Qwen/Qwen2.5-VL-7B-Instruct";
      setHfModel(savedModel);
    }
  }, []);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const addFilesToQueue = (files: FileList) => {
    const validFiles: QueueFile[] = [];
    const maxFiles = 5;
    const currentLen = filesQueue.length;
    const allowedNew = maxFiles - currentLen;
    
    if (allowedNew <= 0) {
      alert("Queue is full! Maximum 5 documents can be uploaded at a time.");
      return;
    }

    const filesToProcess = Array.from(files).slice(0, allowedNew);

    filesToProcess.forEach((file) => {
      if (file.type.startsWith("image/")) {
        validFiles.push({
          id: Math.random().toString(36).substring(7),
          file: file,
          name: file.name,
          preview: URL.createObjectURL(file),
          status: "pending",
          progress: 0,
        });
      }
    });

    if (validFiles.length > 0) {
      setFilesQueue((prev) => {
        const updated = [...prev, ...validFiles];
        if (activeQueueIndex === null) {
          setActiveQueueIndex(prev.length);
        }
        return updated;
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(e.target.files);
    }
  };

  const clearQueueItem = (index: number) => {
    setFilesQueue((prev) => {
      const filtered = prev.filter((_, i) => i !== index);
      if (activeQueueIndex === index) {
        setActiveQueueIndex(filtered.length > 0 ? 0 : null);
      } else if (activeQueueIndex !== null && activeQueueIndex > index) {
        setActiveQueueIndex(activeQueueIndex - 1);
      }
      return filtered;
    });
  };

  const clearAllQueue = () => {
    setFilesQueue([]);
    setActiveQueueIndex(null);
    setPredictError("");
    setProgressLog("");
    setExtractedForm({
      name: "",
      fathersName: "",
      dob: "",
      panNumber: "",
      aadhaarNumber: "",
      certificateId: "",
      address: "",
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // HTML5 Canvas Preprocessing
  const preprocessImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(img.src);
          return;
        }

        let w = img.width;
        let h = img.height;
        let startY = 0;
        let endY = h;

        // 1. Phone UI crop (top 8%, bottom 8% for vertical screenshots)
        if (h > w * 1.5 && h > 1000) {
          startY = Math.floor(h * 0.08);
          endY = Math.floor(h * 0.92);
          h = endY - startY;
        }

        canvas.width = w;
        canvas.height = h;

        // Apply contrast & brightness to make texts sharper
        ctx.filter = "contrast(1.25) brightness(1.05)";
        ctx.drawImage(img, 0, startY, w, h, 0, 0, w, h);

        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
    });
  };

  // Convert Base64 Data URL to standard Blob
  const base64ToBlob = (base64Data: string) => {
    const byteString = atob(base64Data.split(",")[1]);
    const mimeString = base64Data.split(",")[0].split(":")[1].split(";")[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
  };

  // Call Hugging Face API (proxied via Rust in Tauri to bypass CORS)
  const performHFOcr = async (base64Image: string, token: string, selectedModel: string): Promise<string> => {
    const rawBase64 = base64Image.split(",")[1];
    
    if (isTauriEnv && invoke) {
      try {
        const text = await invoke("send_hf_request", {
          url: `https://api-inference.huggingface.co/models/${selectedModel}/v1/chat/completions`,
          token: token,
          model: selectedModel,
          imageBase64: rawBase64,
        });
        return text;
      } catch (e: any) {
        throw new Error(e.message || e.toString());
      }
    } else {
      // Fallback for regular web browsers
      const response = await fetch(
        `https://api-inference.huggingface.co/models/${selectedModel}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: selectedModel,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image_url",
                    image_url: { url: `data:image/jpeg;base64,${rawBase64}` }
                  },
                  {
                    type: "text",
                    text: "Extract all text from this government document image. Maintain structural reading layout and correct spelling."
                  }
                ]
              }
            ],
            max_tokens: 512
          })
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `HTTP error ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    }
  };

  // Process Batch
  const performBatchOCR = async () => {
    if (filesQueue.length === 0 || isBatchProcessing) return;
    setIsBatchProcessing(true);
    setPredictError("");

    const activeToken = localStorage.getItem("hf_token") || "";

    if (!activeToken) {
      alert("Hugging Face API Access Token is missing! Set it in Settings to run.");
      setIsBatchProcessing(false);
      return;
    }

    for (let i = 0; i < filesQueue.length; i++) {
      const currentItem = filesQueue[i];
      if (currentItem.status === "completed") continue;

      setFilesQueue((prev) => {
        const copy = [...prev];
        copy[i].status = "processing";
        copy[i].progress = 10;
        return copy;
      });

      const t0 = Date.now();

      try {
        // 1. Preprocess
        setProgressLog(`Preprocessing ${currentItem.name}...`);
        const preprocessedBase64 = await preprocessImage(currentItem.file);
        
        setFilesQueue((prev) => {
          const copy = [...prev];
          copy[i].progress = 30;
          return copy;
        });

        // 2. Perform OCR
        setProgressLog(`Running VLM OCR extraction on ${currentItem.name}...`);
        
        const extractedText = await performHFOcr(preprocessedBase64, activeToken, hfModel);

        // 3. Parse Metadata
        setProgressLog(`Parsing fields from ${currentItem.name}...`);
        const parsedData = parseOCRResult(extractedText);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

        // 4. Update Form Fields
        const fields = parsedData.fields;
        setExtractedForm((prev) => ({
          ...prev,
          name: fields.name || prev.name,
          fathersName: fields.fathers_name || prev.fathersName,
          dob: fields.dob || prev.dob,
          panNumber: parsedData.document_type === "PAN" ? (fields.doc_number || prev.panNumber) : prev.panNumber,
          aadhaarNumber: parsedData.document_type === "Aadhaar" ? (fields.doc_number || prev.aadhaarNumber) : prev.aadhaarNumber,
          certificateId: parsedData.document_type === "Nivas" ? (fields.doc_number || prev.certificateId) : prev.certificateId,
          address: fields.address || prev.address,
        }));

        setFilesQueue((prev) => {
          const copy = [...prev];
          copy[i].status = "completed";
          copy[i].progress = 100;
          copy[i].resultText = extractedText;
          copy[i].parsedData = parsedData;
          copy[i].elapsed = parseFloat(elapsed);
          return copy;
        });

      } catch (e: any) {
        console.error(e);
        let errMsg = e.message || e.toString();
        if (hfModel.includes("olmOCR")) {
          errMsg += "\n\n💡 Note: The 'allenai/olmOCR-2-7B-1025-FP8' model is not hosted on Hugging Face's serverless Inference API. Please select 'Qwen2.5-VL 7B' (Recommended - 100% free and hosted) from Settings, or deploy your own endpoint.";
        }
        setFilesQueue((prev) => {
          const copy = [...prev];
          copy[i].status = "failed";
          copy[i].progress = 100;
          copy[i].error = errMsg;
          return copy;
        });
      }
    }
    
    setProgressLog("Batch processing completed.");
    setIsBatchProcessing(false);
  };

  const handleFormFieldChange = (field: keyof typeof extractedForm, value: string) => {
    setExtractedForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleModelChange = (model: string) => {
    setHfModel(model);
    localStorage.setItem("hf_model", model);
  };

  const saveHfToken = () => {
    if (!hfToken.trim()) {
      alert("Please enter a valid Hugging Face Access Token.");
      return;
    }
    localStorage.setItem("hf_token", hfToken.trim());
    setHfTokenSet(true);
    setHfToken("");
    alert("Token saved successfully!");
  };

  const removeHfToken = () => {
    localStorage.removeItem("hf_token");
    setHfTokenSet(false);
    alert("Token removed.");
  };

  const exportFormAsJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(extractedForm, null, 2));
    const dlAnchorElem = document.createElement("a");
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "extracted_form_data.json");
    dlAnchorElem.click();
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div>
          <div className="sidebar-brand">
            <div className="brand-logo">E</div>
            <div className="brand-name">EduSphere OCR</div>
          </div>

          <nav className="nav-menu">
            <div
              className={`nav-item ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              📊 Document OCR
            </div>
            <div
              className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
              onClick={() => setActiveTab("settings")}
            >
              ⚙️ Engine Settings
            </div>
          </nav>
        </div>

        {/* Sidebar Status Info */}
        <div className="sidebar-status">
          <div className="status-row">
            <span className="status-label">Hugging Face API</span>
            <span className="status-value">
              <span className={`status-dot ${hfTokenSet ? "active" : "inactive"}`} />
              {hfTokenSet ? "Connected" : "Offline"}
            </span>
          </div>
          <div className="status-row">
            <span className="status-label">Active Model</span>
            <span className="status-value" style={{ color: "var(--accent-cyan)", fontWeight: "bold", fontSize: "0.72rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "120px" }}>
              {hfModel.split("/")[1] || hfModel}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Panel Content */}
      <main className="main-content">
        <header className="header">
          <div className="header-title">
            <h1>{activeTab === "dashboard" ? "Scanned Document OCR" : "System & Engine Settings"}</h1>
            <p>
              {activeTab === "dashboard"
                ? "Upload printed/handwritten documents in Hindi & English to auto-populate the registration form"
                : "Manage local WebAssembly execution and Hugging Face serverless VLM API access settings"}
            </p>
          </div>
        </header>

        {/* 1. Dashboard Tab */}
        {activeTab === "dashboard" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr", gap: "20px", height: "calc(100vh - 120px)", overflow: "hidden", padding: "4px" }}>
            
            {/* Left Column: Upload & Queue */}
            <div className="workspace-card" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
              <div className="card-title">
                <span>📁 Upload Queue ({filesQueue.length}/5)</span>
                {filesQueue.length > 0 && (
                  <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "0.8rem", color: "var(--danger)" }} onClick={clearAllQueue}>
                    Clear All
                  </button>
                )}
              </div>

              {/* Upload Drop Zone */}
              <div
                className={`upload-container ${dragActive ? "drag-active" : ""}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{ minHeight: "130px", maxHeight: "150px", padding: "12px", marginBottom: "16px" }}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                />
                <div style={{ fontSize: "1.5rem", marginBottom: "4px" }}>📥</div>
                <p style={{ fontSize: "0.85rem", fontWeight: 600 }}>Drag & Drop Scanned Docs</p>
                <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "2px" }}>Accepts PAN, Aadhaar, Certs</p>
              </div>

              {/* File list */}
              <div style={{ flexGrow: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px" }}>
                {filesQueue.length === 0 ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "20px" }}>
                    No documents uploaded. Add files to begin batch extraction.
                  </div>
                ) : (
                  filesQueue.map((item, index) => (
                    <div
                      key={item.id}
                      onClick={() => setActiveQueueIndex(index)}
                      style={{
                        padding: "10px",
                        borderRadius: "8px",
                        border: activeQueueIndex === index ? "1px solid var(--accent-cyan)" : "1px solid var(--panel-border)",
                        background: activeQueueIndex === index ? "rgba(102, 252, 241, 0.05)" : "rgba(255,255,255,0.01)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "75%" }}>
                        <img src={item.preview} style={{ width: "36px", height: "36px", borderRadius: "4px", objectFit: "cover" }} />
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                          <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-bright)", margin: 0 }}>{item.name}</p>
                          <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0 }}>
                            {item.status === "completed" && `✅ Done • ${item.elapsed}s`}
                            {item.status === "processing" && `⏳ Processing (${item.progress}%)`}
                            {item.status === "pending" && `⏳ Ready`}
                            {item.status === "failed" && `❌ Error`}
                          </p>
                        </div>
                      </div>
                      
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {item.status === "processing" && (
                          <div style={{ width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "var(--accent-cyan)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                        )}
                        <button
                          style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: "1rem" }}
                          onClick={(e) => { e.stopPropagation(); clearQueueItem(index); }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Action bar */}
              <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--panel-border)" }}>
                {progressLog && (
                  <p style={{ fontSize: "0.75rem", color: "var(--accent-cyan)", marginBottom: "8px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                    {progressLog}
                  </p>
                )}
                <button
                  className="btn-primary"
                  onClick={performBatchOCR}
                  disabled={filesQueue.length === 0 || isBatchProcessing}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {isBatchProcessing ? "Extracting Batch..." : "⚡ Run Batch OCR"}
                </button>
              </div>
            </div>

            {/* Middle Column: Structured Form Fields */}
            <div className="workspace-card" style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>
              <div className="card-title">
                <span>📝 Unified Auto-populated Form</span>
                <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "0.8rem" }} onClick={exportFormAsJSON}>
                  Export JSON
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Name */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>FULL NAME</label>
                  <input
                    type="text"
                    value={extractedForm.name}
                    onChange={(e) => handleFormFieldChange("name", e.target.value)}
                    placeholder="Auto-populated from documents"
                    style={{ padding: "10px", borderRadius: "6px", border: "1px solid var(--panel-border)", background: "rgba(0,0,0,0.2)", color: "var(--text-bright)", outline: "none", fontSize: "0.88rem" }}
                  />
                </div>

                {/* Father's Name */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>FATHER'S NAME</label>
                  <input
                    type="text"
                    value={extractedForm.fathersName}
                    onChange={(e) => handleFormFieldChange("fathersName", e.target.value)}
                    placeholder="Auto-populated from documents"
                    style={{ padding: "10px", borderRadius: "6px", border: "1px solid var(--panel-border)", background: "rgba(0,0,0,0.2)", color: "var(--text-bright)", outline: "none", fontSize: "0.88rem" }}
                  />
                </div>

                {/* DOB */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>DATE OF BIRTH</label>
                  <input
                    type="text"
                    value={extractedForm.dob}
                    onChange={(e) => handleFormFieldChange("dob", e.target.value)}
                    placeholder="Auto-populated from documents"
                    style={{ padding: "10px", borderRadius: "6px", border: "1px solid var(--panel-border)", background: "rgba(0,0,0,0.2)", color: "var(--text-bright)", outline: "none", fontSize: "0.88rem" }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  {/* PAN */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600 }}>PAN NUMBER</label>
                    <input
                      type="text"
                      value={extractedForm.panNumber}
                      onChange={(e) => handleFormFieldChange("panNumber", e.target.value)}
                      placeholder="Auto-populated"
                      style={{ padding: "10px", borderRadius: "6px", border: "1px solid var(--panel-border)", background: "rgba(0,0,0,0.2)", color: "var(--text-bright)", outline: "none", fontSize: "0.85rem" }}
                    />
                  </div>

                  {/* Aadhaar */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600 }}>AADHAAR NUMBER</label>
                    <input
                      type="text"
                      value={extractedForm.aadhaarNumber}
                      onChange={(e) => handleFormFieldChange("aadhaarNumber", e.target.value)}
                      placeholder="Auto-populated"
                      style={{ padding: "10px", borderRadius: "6px", border: "1px solid var(--panel-border)", background: "rgba(0,0,0,0.2)", color: "var(--text-bright)", outline: "none", fontSize: "0.85rem" }}
                    />
                  </div>
                </div>

                {/* Certificate ID */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>RESIDENCE CERTIFICATE ID</label>
                  <input
                    type="text"
                    value={extractedForm.certificateId}
                    onChange={(e) => handleFormFieldChange("certificateId", e.target.value)}
                    placeholder="Auto-populated from residence certificate"
                    style={{ padding: "10px", borderRadius: "6px", border: "1px solid var(--panel-border)", background: "rgba(0,0,0,0.2)", color: "var(--text-bright)", outline: "none", fontSize: "0.88rem" }}
                  />
                </div>

                {/* Address */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>ADDRESS</label>
                  <textarea
                    value={extractedForm.address}
                    onChange={(e) => handleFormFieldChange("address", e.target.value)}
                    placeholder="Auto-populated from documents"
                    rows={3}
                    style={{ padding: "10px", borderRadius: "6px", border: "1px solid var(--panel-border)", background: "rgba(0,0,0,0.2)", color: "var(--text-bright)", outline: "none", fontSize: "0.88rem", resize: "none" }}
                  />
                </div>
              </div>
            </div>

            {/* Right Column: Selected File Details & Raw OCR */}
            <div className="workspace-card" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
              <div className="card-title">
                <span>🔍 Document Preview &amp; OCR</span>
              </div>

              {activeQueueIndex !== null && filesQueue[activeQueueIndex] ? (
                <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
                  {/* Miniature Image Preview */}
                  <div style={{ height: "120px", display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(0,0,0,0.2)", borderRadius: "6px", overflow: "hidden", marginBottom: "16px" }}>
                    <img src={filesQueue[activeQueueIndex].preview} style={{ height: "100%", width: "auto", objectFit: "contain" }} />
                  </div>

                  <p style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-bright)", marginBottom: "4px" }}>
                    {filesQueue[activeQueueIndex].name}
                  </p>
                  
                  {filesQueue[activeQueueIndex].elapsed && (
                    <p style={{ fontSize: "0.72rem", color: "var(--accent-cyan)", marginBottom: "12px" }}>
                      Processing Time: {filesQueue[activeQueueIndex].elapsed}s
                    </p>
                  )}

                  {/* Raw OCR Text Box */}
                  <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600, marginBottom: "6px" }}>RAW EXTRACTED TEXT</label>
                    <div style={{ flexGrow: 1, overflowY: "auto", padding: "10px", borderRadius: "6px", border: "1px solid var(--panel-border)", background: "rgba(0,0,0,0.35)", color: "var(--text-primary)", fontSize: "0.8rem", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                      {filesQueue[activeQueueIndex].status === "processing" && (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "10px" }}>
                          <div style={{ width: "20px", height: "20px", border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "var(--accent-cyan)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                          <p style={{ color: "var(--text-muted)" }}>Running extraction pipeline...</p>
                        </div>
                      )}
                      {filesQueue[activeQueueIndex].status === "failed" && (
                        <div style={{ color: "var(--danger)" }}>
                          Error during OCR extraction:<br /><br />
                          {filesQueue[activeQueueIndex].error}
                        </div>
                      )}
                      {filesQueue[activeQueueIndex].status === "completed" && (
                        filesQueue[activeQueueIndex].resultText || "No text extracted."
                      )}
                      {filesQueue[activeQueueIndex].status === "pending" && (
                        <div style={{ color: "var(--text-muted)", textAlign: "center", marginTop: "20px" }}>
                          Click "Run Batch OCR" to extract this document's text.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center" }}>
                  Select an item in the upload queue to preview the file and view its raw OCR text.
                </div>
              )}
            </div>

          </div>
        )}

        {/* 2. Settings Tab */}
        {activeTab === "settings" && (
          <div className="settings-container">

            {/* Hugging Face API Configuration Card */}
            <div className="settings-card">
              <h3 className="settings-section-title">🔑 Hugging Face API Access</h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "12px" }}>
                Enter your free Hugging Face API access token and select which VLM model you want to query.
              </p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Access Token Input */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>ACCESS TOKEN</label>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <input
                      type="password"
                      value={hfToken}
                      onChange={(e) => setHfToken(e.target.value)}
                      placeholder={hfTokenSet ? "•••••••••••••••••••• (Saved)" : "Enter HF Access Token (hf_...)"}
                      style={{
                        flexGrow: 1,
                        padding: "10px",
                        borderRadius: "6px",
                        border: "1px solid var(--panel-border)",
                        background: "rgba(0,0,0,0.2)",
                        color: "var(--text-bright)",
                        outline: "none",
                        fontSize: "0.85rem"
                      }}
                    />
                    {hfTokenSet ? (
                      <button className="btn-secondary" onClick={removeHfToken} style={{ fontSize: "0.85rem", padding: "8px 16px", color: "var(--danger)" }}>
                        Remove Token
                      </button>
                    ) : (
                      <button className="btn-primary" onClick={saveHfToken} style={{ fontSize: "0.85rem", padding: "8px 16px" }}>
                        Save Token
                      </button>
                    )}
                  </div>
                </div>

                {/* Model Selector Dropdown */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>ACTIVE CLOUD VLM MODEL</label>
                  <select
                    value={hfModel}
                    onChange={(e) => handleModelChange(e.target.value)}
                    style={{
                      padding: "10px",
                      borderRadius: "6px",
                      border: "1px solid var(--panel-border)",
                      background: "rgba(31, 40, 51, 0.95)",
                      color: "var(--text-bright)",
                      outline: "none",
                      fontSize: "0.85rem",
                      cursor: "pointer"
                    }}
                  >
                    <option value="Qwen/Qwen2.5-VL-7B-Instruct">Qwen2.5-VL 7B (Recommended - State-of-the-Art Document OCR)</option>
                    <option value="allenai/olmOCR-2-7B-1025-FP8">allenai/olmOCR-2-7B-1025-FP8 (Demo Model - Ultra High PDF Throughput)</option>
                    <option value="Qwen/Qwen2-VL-7B-Instruct">Qwen2-VL 7B (Standard - Excellent Multilingual OCR)</option>
                    <option value="meta-llama/Llama-3.2-11B-Vision-Instruct">meta-llama/Llama-3.2-11B-Vision-Instruct (Llama 3.2 11B Vision)</option>
                  </select>
                </div>

                <div className="status-row" style={{ padding: "6px 0", fontSize: "0.8rem", color: "var(--text-muted)", borderTop: "1px solid var(--panel-border)", paddingTop: "12px" }}>
                  <span>Token Status:</span>
                  <span style={{ color: hfTokenSet ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                    {hfTokenSet ? "● SAVED & ACTIVE" : "● MISSING (VLM disabled)"}
                  </span>
                </div>
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
