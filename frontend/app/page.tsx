"use client";
import React, { useState, useRef, useEffect } from "react";
import { DocumentFieldsSchema, type DocumentFields } from "./schema";
import { preprocessImage, type PreprocessResult } from "./preprocess";

const MODELS = [
  { id: "gemini-2.0-flash-lite", name: "2.0 Flash Lite", provider: "Google", modelId: "gemini-2.0-flash-lite", costIn: 0.075, costOut: 0.30 },
  { id: "gemini-2.0-flash", name: "2.0 Flash", provider: "Google", modelId: "gemini-2.0-flash", costIn: 0.10, costOut: 0.40 },
  { id: "gemini-2.5-flash", name: "2.5 Flash", provider: "Google", modelId: "gemini-2.5-flash", costIn: 0.15, costOut: 0.60 },
  { id: "gemini-2.5-pro", name: "2.5 Pro", provider: "Google", modelId: "gemini-2.5-pro", costIn: 1.25, costOut: 5.00 },
  { id: "groq", name: "Llama 4 Scout", provider: "Groq", modelId: "meta-llama/llama-4-scout-17b-16e-instruct", costIn: 0, costOut: 0 },
];

const SYSTEM_PROMPT = `You are a document analysis assistant. Analyze the provided document image and extract all visible information. Return a valid JSON object with these fields:
- documentType: the type of document (e.g., Aadhaar, PAN, Birth Certificate, Transfer Certificate, Driving License, Voter ID, Passport, Bank Statement, Invoice, Report Card, Other)
- name: full name of the person
- dateOfBirth: date of birth (DD-MM-YYYY)
- fatherName: father's or spouse's name
- address: complete address
- mobileNumber: phone number
- email: email address
- documentNumber: any document ID number
- gender: gender if mentioned
- additionalFields: any other fields found (as key-value pairs)

Only include fields that are clearly visible in the document. Return ONLY valid JSON, no other text.`;

async function callGemini(base64: string, apiKey: string, modelId: string): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: SYSTEM_PROMPT },
          { inline_data: { mime_type: "image/jpeg", data: base64.split(",")[1] } },
        ],
      }],
    }),
  });
  if (res.status === 429) throw new Error("Gemini API rate limit exceeded (429). Wait a minute or check your usage quota at aistudio.google.com.");
  if (!res.ok) throw new Error(`Gemini API error (${res.status}): ${(await res.text()).slice(0, 100)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const meta = data?.usageMetadata || {};
  return {
    text,
    usage: {
      promptTokens: meta.promptTokenCount || 0,
      completionTokens: meta.candidatesTokenCount || 0,
      totalTokens: meta.totalTokenCount || 0,
    },
  };
}

async function callGroq(base64: string, apiKey: string, modelId: string): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelId,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: SYSTEM_PROMPT },
          { type: "image_url", image_url: { url: base64 } },
        ],
      }],
      max_tokens: 2048,
    }),
  });
  if (res.status === 429) throw new Error("Groq API rate limit exceeded (429). Wait a moment and try again.");
  if (!res.ok) throw new Error(`Groq API error (${res.status}): ${(await res.text()).slice(0, 100)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  const usage = data?.usage || {};
  return {
    text,
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    },
  };
}

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

interface DocItem {
  id: number;
  file: File;
  preview: string;
  processed: PreprocessResult | null;
  loading: boolean;
  error: string | null;
  result: { rawText: string; parsed: DocumentFields; usage: { promptTokens: number; completionTokens: number; totalTokens: number }; cost: number } | null;
  validationErrors: string[];
}

export default function Home() {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [selectedModel, setSelectedModel] = useState("gemini-2.0-flash-lite");
  const [running, setRunning] = useState(false);
  const [batchResults, setBatchResults] = useState<{ totalTokens: number; totalCost: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");

  useEffect(() => {
    setGeminiKey(localStorage.getItem("gemini_key") || "");
    setGroqKey(localStorage.getItem("groq_key") || "");
  }, []);

  const addFiles = (files: FileList) => {
    const newDocs: DocItem[] = [];
    Array.from(files).forEach((file, i) => {
      const reader = new FileReader();
      const id = Date.now() + i;
      reader.onload = () => {
        setDocs(prev => [...prev, { id, file, preview: reader.result as string, processed: null, loading: false, error: null, result: null, validationErrors: [] }]);
      };
      reader.readAsDataURL(file);
    });
    if (newDocs.length === 0) setTimeout(() => {}, 100);
  };

  const removeDoc = (id: number) => setDocs(prev => prev.filter(d => d.id !== id));

  const processAll = async () => {
    if (docs.length === 0 || running) return;
    setRunning(true);
    setBatchResults(null);

    const model = MODELS.find(m => m.id === selectedModel)!;
    const key = model.provider === "Google" ? geminiKey : groqKey;
    if (!key) {
      setRunning(false);
      return;
    }

    let totalTokens = 0;
    let totalCost = 0;

    for (let idx = 0; idx < docs.length; idx++) {
      const doc = docs[idx];
      setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, loading: true, error: null, result: null } : d));

      try {
        // Step 1: Preprocess (crop → smart filter → optimize)
        const processed = await preprocessImage(doc.preview);
        setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, processed } : d));

        // Step 2: Call API
        const { text, usage } = model.provider === "Google"
          ? await callGemini(processed.processed, key, model.modelId)
          : await callGroq(processed.processed, key, model.modelId);

        // Step 3: Parse & validate
        const jsonStr = extractJson(text);
        let parsed: DocumentFields;
        const validationErrors: string[] = [];
        try {
          const raw = JSON.parse(jsonStr);
          const validated = DocumentFieldsSchema.safeParse(raw);
          if (validated.success) {
            parsed = validated.data;
          } else {
            parsed = raw as DocumentFields;
            validationErrors.push(...validated.error.issues.map(i => `${i.path.join(".")}: ${i.message}`));
          }
        } catch {
          parsed = { documentType: "Unknown" };
          validationErrors.push("Failed to parse model response as JSON");
        }

        const cost = (usage.promptTokens * model.costIn + usage.completionTokens * model.costOut) / 1_000_000;
        totalTokens += usage.totalTokens;
        totalCost += cost;

        setDocs(prev => prev.map(d => d.id === doc.id ? {
          ...d, loading: false,
          result: { rawText: text, parsed, usage, cost },
          validationErrors,
        } : d));
      } catch (e: any) {
        setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, loading: false, error: e.message || "Analysis failed" } : d));
      }
    }

    setBatchResults({ totalTokens, totalCost });
    setRunning(false);
  };

  const model = MODELS.find(m => m.id === selectedModel)!;

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 600, margin: "0 0 4px 0" }}>Document Analysis</h1>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: "0 0 20px 0" }}>
        Upload documents &mdash; auto-crop, smart filter, and extract structured data with AI
      </p>

      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "16px" }}>
        {/* Model Selection */}
        <div className="card" style={{ flex: "0 0 240px", alignSelf: "flex-start" }}>
          <div className="card-header">
            <span className="card-title">Model</span>
          </div>
          <div style={{ marginBottom: "4px", fontSize: "0.72rem", color: "var(--text-muted)" }}>Google Gemini</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px", marginBottom: "8px" }}>
            {MODELS.filter(m => m.provider === "Google").map(m => (
              <label key={m.id} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", cursor: "pointer", padding: "4px 6px", borderRadius: "4px", background: selectedModel === m.id ? "var(--accent-light)" : "transparent" }}>
                <input type="radio" name="model" checked={selectedModel === m.id} onChange={() => setSelectedModel(m.id)} />
                {m.name}
                <span style={{ marginLeft: "auto", fontSize: "0.6rem", color: "var(--text-muted)" }}>${m.costIn}/{m.costOut}/1M</span>
              </label>
            ))}
          </div>
          <div style={{ marginBottom: "4px", fontSize: "0.72rem", color: "var(--text-muted)" }}>Groq</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px", marginBottom: "12px" }}>
            {MODELS.filter(m => m.provider === "Groq").map(m => (
              <label key={m.id} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", cursor: "pointer", padding: "4px 6px", borderRadius: "4px", background: selectedModel === m.id ? "var(--accent-light)" : "transparent" }}>
                <input type="radio" name="model" checked={selectedModel === m.id} onChange={() => setSelectedModel(m.id)} />
                {m.name}
                <span style={{ marginLeft: "auto", fontSize: "0.6rem", color: "var(--text-muted)" }}>Free</span>
              </label>
            ))}
          </div>

          <div style={{ borderTop: "1px solid var(--border-light)", paddingTop: "12px", marginTop: "4px" }}>
            <div style={{ fontWeight: 600, fontSize: "0.78rem", marginBottom: "6px" }}>Documents ({docs.length})</div>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
              onChange={e => e.target.files && addFiles(e.target.files)} />
            <button className="btn" style={{ width: "100%", marginBottom: "6px" }} onClick={() => fileRef.current?.click()}>
              📁 Add Images
            </button>
            {docs.length > 0 && (
              <>
                <button className="btn btn-primary" style={{ width: "100%", marginBottom: "6px" }} onClick={processAll} disabled={running}>
                  {running ? `⏳ Processing...` : "▶ Analyze All"}
                </button>
                <button className="btn btn-sm" style={{ width: "100%" }} onClick={() => { setDocs([]); setBatchResults(null); }}>
                  ✕ Clear All
                </button>
              </>
            )}
          </div>
        </div>

        {/* Documents Area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {docs.length === 0 ? (
            <div className="upload-zone" style={{ maxWidth: "500px", margin: "20px auto", cursor: "pointer" }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "8px" }}>📄</div>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Drop documents here</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>or click to browse (multiple allowed)</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Batch Summary */}
              {batchResults && (
                <div className="card" style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", gap: "20px", fontSize: "0.85rem" }}>
                    <span>📄 <strong>{docs.length}</strong> documents</span>
                    <span>🔤 <strong>{batchResults.totalTokens}</strong> total tokens</span>
                    <span>💰 <strong>${batchResults.totalCost.toFixed(6)}</strong> total cost</span>
                  </div>
                </div>
              )}

              {/* Per-document results */}
              {docs.map((doc) => (
                <div key={doc.id} className="card">
                  <div className="card-header" style={{ marginBottom: "8px", paddingBottom: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{doc.file.name}</span>
                      {doc.processed?.appliedFilters && (
                        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                          {doc.processed.appliedFilters.join(" · ")}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      {doc.loading && <span className="badge badge-processing">PROCESSING</span>}
                      {doc.result && <span className="badge badge-success">DONE</span>}
                      {doc.error && <span className="badge badge-error">ERROR</span>}
                      <button className="btn btn-xs" onClick={() => removeDoc(doc.id)}>✕</button>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    {/* Side-by-side preview */}
                    <div style={{ display: "flex", gap: "8px", flex: "0 0 auto" }}>
                      <div>
                        <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "2px" }}>Original</div>
                        <img src={doc.preview} alt="original" style={{ width: "120px", height: "90px", objectFit: "cover", borderRadius: "4px", border: "1px solid var(--border-light)" }} />
                      </div>
                      {doc.processed && (
                        <div>
                          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "2px" }}>Processed</div>
                          <img src={doc.processed.processed} alt="processed" style={{ width: "120px", height: "90px", objectFit: "cover", borderRadius: "4px", border: "1px solid var(--border-light)" }} />
                        </div>
                      )}
                    </div>

                    {/* Results */}
                    <div style={{ flex: 1, minWidth: "200px" }}>
                      {doc.loading && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "20px 0", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                          <span className="dot dot-yellow" style={{ width: "12px", height: "12px" }} /> Processing...
                        </div>
                      )}
                      {doc.error && (
                        <div style={{ color: "var(--danger)", fontSize: "0.78rem", padding: "8px 0" }}>❌ {doc.error}</div>
                      )}
                      {doc.result && (
                        <div>
                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
                            <div className="stat-box" style={{ padding: "6px 10px" }}>
                              <div className="stat-value" style={{ fontSize: "0.85rem" }}>{doc.result.usage.totalTokens}</div>
                              <div className="stat-label">Tokens</div>
                            </div>
                            <div className="stat-box" style={{ padding: "6px 10px" }}>
                              <div className="stat-value" style={{ fontSize: "0.85rem" }}>${doc.result.cost.toFixed(6)}</div>
                              <div className="stat-label">Cost</div>
                            </div>
                            {doc.result.parsed.documentType && (
                              <div className="stat-box" style={{ padding: "6px 10px" }}>
                                <div className="stat-value" style={{ fontSize: "0.85rem" }}><span className="badge badge-success">{doc.result.parsed.documentType}</span></div>
                                <div className="stat-label">Type</div>
                              </div>
                            )}
                          </div>

                          {doc.validationErrors.length > 0 && (
                            <div style={{ background: "#fff3cd", padding: "6px 10px", borderRadius: "4px", fontSize: "0.7rem", color: "#856404", marginBottom: "8px" }}>
                              {doc.validationErrors.map((v, i) => <div key={i}>⚠ {v}</div>)}
                            </div>
                          )}

                          <div className="field-list" style={{ gap: "2px" }}>
                            {doc.result.parsed.name && (
                              <div className="field-row" style={{ padding: "4px 8px" }}>
                                <span className="field-label">Name</span>
                                <span className="field-value">{doc.result.parsed.name}</span>
                              </div>
                            )}
                            {doc.result.parsed.dateOfBirth && (
                              <div className="field-row" style={{ padding: "4px 8px" }}>
                                <span className="field-label">DOB</span>
                                <span className="field-value">{doc.result.parsed.dateOfBirth}</span>
                              </div>
                            )}
                            {doc.result.parsed.fatherName && (
                              <div className="field-row" style={{ padding: "4px 8px" }}>
                                <span className="field-label">Father</span>
                                <span className="field-value">{doc.result.parsed.fatherName}</span>
                              </div>
                            )}
                            {doc.result.parsed.documentNumber && (
                              <div className="field-row" style={{ padding: "4px 8px" }}>
                                <span className="field-label">Doc No.</span>
                                <span className="field-value">{doc.result.parsed.documentNumber}</span>
                              </div>
                            )}
                            {doc.result.parsed.mobileNumber && (
                              <div className="field-row" style={{ padding: "4px 8px" }}>
                                <span className="field-label">Mobile</span>
                                <span className="field-value">{doc.result.parsed.mobileNumber}</span>
                              </div>
                            )}
                            {doc.result.parsed.address && (
                              <div className="field-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: "2px", padding: "4px 8px" }}>
                                <span className="field-label">Address</span>
                                <span className="field-value" style={{ whiteSpace: "pre-wrap", fontSize: "0.75rem" }}>{doc.result.parsed.address}</span>
                              </div>
                            )}
                            {doc.result.parsed.additionalFields && Object.entries(doc.result.parsed.additionalFields).length > 0 && (
                              <details style={{ marginTop: "4px" }}>
                                <summary style={{ cursor: "pointer", fontSize: "0.72rem", color: "var(--text-secondary)" }}>Additional fields ({Object.entries(doc.result.parsed.additionalFields).length})</summary>
                                <div style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "2px" }}>
                                  {Object.entries(doc.result.parsed.additionalFields).map(([k, v]) => (
                                    <div key={k} className="field-row" style={{ padding: "3px 6px", background: "var(--bg)" }}>
                                      <span className="field-label" style={{ fontSize: "0.65rem" }}>{k}</span>
                                      <span className="field-value" style={{ fontSize: "0.65rem" }}>{v}</span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
