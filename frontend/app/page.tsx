"use client";
import React, { useState, useRef, useEffect } from "react";
import { DocumentFieldsSchema, type DocumentFields } from "./schema";
import { preprocessImage, type PreprocessResult } from "./preprocess";
import { reconcileDocuments, type FieldEntry, type ReconciledData } from "./reconcile";

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
- motherName: mother's name
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
  const [reconciled, setReconciled] = useState<{ entries: FieldEntry[]; data: ReconciledData; hasMismatches: boolean } | null>(null);
  const [showRecon, setShowRecon] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");

  // Admission form editable fields
  const [formData, setFormData] = useState({
    name: "", dateOfBirth: "", gender: "", fatherName: "", motherName: "",
    address: "", mobileNumber: "", email: "",
    classApplying: "", previousSchool: "", previousClass: "",
  });

  useEffect(() => {
    setGeminiKey(localStorage.getItem("gemini_key") || "");
    setGroqKey(localStorage.getItem("groq_key") || "");
  }, []);

  useEffect(() => {
    if (reconciled && reconciled.data) {
      const d = reconciled.data;
      setFormData(prev => ({
        ...prev,
        name: d.name || prev.name,
        dateOfBirth: d.dateOfBirth || prev.dateOfBirth,
        gender: d.gender || prev.gender,
        fatherName: d.fatherName || prev.fatherName,
        motherName: d.motherName || prev.motherName,
        address: d.address || prev.address,
        mobileNumber: d.mobileNumber || prev.mobileNumber,
        email: d.email || prev.email,
      }));
    }
  }, [reconciled]);

  const addFiles = (files: FileList) => {
    Array.from(files).forEach((file, i) => {
      const reader = new FileReader();
      const id = Date.now() + i;
      reader.onload = () => {
        setDocs(prev => [...prev, { id, file, preview: reader.result as string, processed: null, loading: false, error: null, result: null, validationErrors: [] }]);
      };
      reader.readAsDataURL(file);
    });
    setReconciled(null);
    setShowRecon(false);
  };

  const removeDoc = (id: number) => {
    setDocs(prev => prev.filter(d => d.id !== id));
    setReconciled(null);
    setShowRecon(false);
  };

  const processAll = async () => {
    if (docs.length === 0 || running) return;
    setRunning(true);
    setBatchResults(null);
    setReconciled(null);
    setShowRecon(false);

    const model = MODELS.find(m => m.id === selectedModel)!;
    const key = model.provider === "Google" ? geminiKey : groqKey;
    if (!key) { setRunning(false); return; }

    let totalTokens = 0;
    let totalCost = 0;

    for (let idx = 0; idx < docs.length; idx++) {
      const doc = docs[idx];
      setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, loading: true, error: null, result: null } : d));
      try {
        const processed = await preprocessImage(doc.preview);
        setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, processed } : d));

        const { text, usage } = model.provider === "Google"
          ? await callGemini(processed.processed, key, model.modelId)
          : await callGroq(processed.processed, key, model.modelId);

        const jsonStr = extractJson(text);
        let parsed: DocumentFields;
        const validationErrors: string[] = [];
        try {
          const raw = JSON.parse(jsonStr);
          const validated = DocumentFieldsSchema.safeParse(raw);
          if (validated.success) parsed = validated.data;
          else { parsed = raw as DocumentFields; validationErrors.push(...validated.error.issues.map(i => `${i.path.join(".")}: ${i.message}`)); }
        } catch {
          parsed = { documentType: "Unknown" };
          validationErrors.push("Failed to parse model response as JSON");
        }

        const cost = (usage.promptTokens * model.costIn + usage.completionTokens * model.costOut) / 1_000_000;
        totalTokens += usage.totalTokens;
        totalCost += cost;

        setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, loading: false, result: { rawText: text, parsed, usage, cost }, validationErrors } : d));
      } catch (e: any) {
        setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, loading: false, error: e.message || "Analysis failed" } : d));
      }
    }

    setBatchResults({ totalTokens, totalCost });
    setRunning(false);
  };

  const runReconciliation = () => {
    const completed = docs.filter(d => d.result);
    if (completed.length < 2) { setShowRecon(true); return; }
    const result = reconcileDocuments(completed.map(d => ({ id: d.id, name: d.file.name, fields: d.result!.parsed })));
    setReconciled({ entries: result.entries, data: result.reconciled, hasMismatches: result.hasMismatches });
    setShowRecon(true);
  };

  useEffect(() => {
    const completed = docs.filter(d => d.result);
    if (completed.length >= 2 && !running) runReconciliation();
  }, [docs, running]);

  const model = MODELS.find(m => m.id === selectedModel)!;

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 600, margin: "0 0 4px 0" }}>School Admission Document Verifier</h1>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: "0 0 20px 0" }}>
        Upload documents (Aadhaar, Birth Certificate, Transfer Certificate, etc.) — auto-crop, extract, reconcile, and generate admission form
      </p>

      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "16px" }}>
        {/* Sidebar */}
        <div className="card" style={{ flex: "0 0 220px", alignSelf: "flex-start" }}>
          <div className="card-header"><span className="card-title">Model</span></div>
          <div style={{ marginBottom: "4px", fontSize: "0.72rem", color: "var(--text-muted)" }}>Google Gemini</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px", marginBottom: "8px" }}>
            {MODELS.filter(m => m.provider === "Google").map(m => (
              <label key={m.id} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", cursor: "pointer", padding: "4px 6px", borderRadius: "4px", background: selectedModel === m.id ? "var(--accent-light)" : "transparent" }}>
                <input type="radio" name="model" checked={selectedModel === m.id} onChange={() => setSelectedModel(m.id)} />
                <span style={{ flex: 1 }}>{m.name}</span>
                <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>${m.costIn}/{m.costOut}/1M</span>
              </label>
            ))}
          </div>
          <div style={{ marginBottom: "4px", fontSize: "0.72rem", color: "var(--text-muted)" }}>Groq</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px", marginBottom: "12px" }}>
            {MODELS.filter(m => m.provider === "Groq").map(m => (
              <label key={m.id} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", cursor: "pointer", padding: "4px 6px", borderRadius: "4px", background: selectedModel === m.id ? "var(--accent-light)" : "transparent" }}>
                <input type="radio" name="model" checked={selectedModel === m.id} onChange={() => setSelectedModel(m.id)} />
                <span style={{ flex: 1 }}>{m.name}</span>
                <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Free</span>
              </label>
            ))}
          </div>
          <div style={{ borderTop: "1px solid var(--border-light)", paddingTop: "12px", marginTop: "4px" }}>
            <div style={{ fontWeight: 600, fontSize: "0.78rem", marginBottom: "6px" }}>Documents ({docs.length})</div>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
              onChange={e => e.target.files && addFiles(e.target.files)} />
            <button className="btn" style={{ width: "100%", marginBottom: "6px" }} onClick={() => fileRef.current?.click()}>📁 Add</button>
            {docs.length > 0 && (
              <>
                <button className="btn btn-primary" style={{ width: "100%", marginBottom: "6px" }} onClick={processAll} disabled={running}>
                  {running ? "⏳ Processing..." : "▶ Analyze All"}
                </button>
                <button className="btn btn-sm" style={{ width: "100%" }} onClick={() => { setDocs([]); setBatchResults(null); setReconciled(null); setShowRecon(false); }}>✕ Clear</button>
              </>
            )}
          </div>
        </div>

        {/* Main Area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {docs.length === 0 ? (
            <div className="upload-zone" style={{ maxWidth: "500px", margin: "20px auto", cursor: "pointer" }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "8px" }}>📄</div>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Upload student documents</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Aadhaar, Birth Certificate, Transfer Certificate, etc.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {batchResults && (
                <div className="card" style={{ padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: "16px", fontSize: "0.8rem", flexWrap: "wrap" }}>
                    <span>📄 <strong>{docs.length}</strong> docs</span>
                    <span>🔤 <strong>{batchResults.totalTokens}</strong> tokens</span>
                    <span>💰 <strong>${batchResults.totalCost.toFixed(6)}</strong> cost</span>
                  </div>
                </div>
              )}

              {/* Document Cards */}
              {docs.map((doc) => (
                <div key={doc.id} className="card" style={{ padding: "12px 14px" }}>
                  <div className="card-header" style={{ marginBottom: "6px", paddingBottom: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>{doc.file.name}</span>
                      {doc.processed?.appliedFilters && (
                        <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>{doc.processed.appliedFilters.join(" · ")}</span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      {doc.loading && <span className="badge badge-processing">...</span>}
                      {doc.result && <span className="badge badge-success">DONE</span>}
                      {doc.error && <span className="badge badge-error">ERR</span>}
                      <button className="btn btn-xs" onClick={() => removeDoc(doc.id)}>✕</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <div><div style={{ fontSize: "0.55rem", color: "var(--text-muted)" }}>Original</div>
                        <img src={doc.preview} alt="" style={{ width: "80px", height: "60px", objectFit: "cover", borderRadius: "4px", border: "1px solid var(--border-light)" }} /></div>
                      {doc.processed && (
                        <div><div style={{ fontSize: "0.55rem", color: "var(--text-muted)" }}>Processed</div>
                          <img src={doc.processed.processed} alt="" style={{ width: "80px", height: "60px", objectFit: "cover", borderRadius: "4px", border: "1px solid var(--border-light)" }} /></div>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: "150px" }}>
                      {doc.loading && <div style={{ padding: "10px 0", color: "var(--text-muted)", fontSize: "0.78rem" }}><span className="dot dot-yellow" /> Processing...</div>}
                      {doc.error && <div style={{ color: "var(--danger)", fontSize: "0.75rem" }}>❌ {doc.error}</div>}
                      {doc.result && (
                        <div>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{doc.result.usage.totalTokens} tok · ${doc.result.cost.toFixed(6)}</span>
                            {doc.result.parsed.documentType && <span className="badge badge-success" style={{ fontSize: "0.6rem" }}>{doc.result.parsed.documentType}</span>}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: "0.72rem" }}>
                            {doc.result.parsed.name && <span><strong>Name:</strong> {doc.result.parsed.name}</span>}
                            {doc.result.parsed.dateOfBirth && <span><strong>DOB:</strong> {doc.result.parsed.dateOfBirth}</span>}
                            {doc.result.parsed.fatherName && <span><strong>Father:</strong> {doc.result.parsed.fatherName}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Reconciliation Section */}
              {showRecon && docs.filter(d => d.result).length >= 1 && (
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">
                      📊 Document Reconciliation
                      {reconciled?.hasMismatches && <span className="badge badge-warning" style={{ marginLeft: "8px" }}>MISMATCHES</span>}
                      {reconciled && !reconciled.hasMismatches && <span className="badge badge-success" style={{ marginLeft: "8px" }}>ALL MATCH</span>}
                    </span>
                  </div>
                  {reconciled ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      {reconciled.entries.map(entry => {
                        if (entry.values.length === 0) return null;
                        const mismatch = !entry.agreed;
                        return (
                          <div key={entry.field} className="field-row" style={{
                            background: mismatch ? "#fef2f2" : "var(--bg)",
                            border: mismatch ? "1px solid rgba(239,68,68,0.2)" : "none",
                            padding: "6px 10px",
                          }}>
                            <div>
                              <div className="field-label">{entry.label}</div>
                              {mismatch && (
                                <div style={{ display: "flex", flexDirection: "column", gap: "1px", marginTop: "2px" }}>
                                  {entry.values.map((v, i) => (
                                    <span key={i} style={{ fontSize: "0.7rem", color: "var(--danger)" }}>
                                      ❌ {v.docName.replace(/\.[^/.]+$/, "")}: {v.value}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <span className="field-value" style={{ color: mismatch ? "var(--danger)" : "var(--success)" }}>
                                {entry.agreedValue || "⚠ Mismatch"}
                              </span>
                              <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>{entry.source}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", padding: "8px 0" }}>
                      Process at least 2 documents to see reconciliation
                    </div>
                  )}
                </div>
              )}

              {/* Admission Form */}
              {(reconciled || docs.filter(d => d.result).length >= 1) && (
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">🎒 Admission Form</span>
                    <button className="btn btn-sm btn-success" onClick={() => {
                      const lines = [
                        "SCHOOL ADMISSION FORM",
                        "====================",
                        "",
                        `Student Name: ${formData.name}`,
                        `Date of Birth: ${formData.dateOfBirth}`,
                        `Gender: ${formData.gender}`,
                        `Father's Name: ${formData.fatherName}`,
                        `Mother's Name: ${formData.motherName}`,
                        `Address: ${formData.address}`,
                        `Mobile: ${formData.mobileNumber}`,
                        `Email: ${formData.email}`,
                        `Class Applying For: ${formData.classApplying}`,
                        `Previous School: ${formData.previousSchool}`,
                        `Previous Class: ${formData.previousClass}`,
                        "",
                        "Documents Submitted:",
                        ...docs.filter(d => d.result).map(d => {
                          const p = d.result!.parsed;
                          return `  - ${p.documentType || "Document"} (${d.file.name}): ${p.documentNumber || "N/A"}`;
                        }),
                      ].join("\n");
                      navigator.clipboard.writeText(lines);
                      alert("Form data copied to clipboard!");
                    }}>📋 Copy Form</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
                    {[
                      { key: "name", label: "Student Name *" },
                      { key: "dateOfBirth", label: "Date of Birth *" },
                      { key: "gender", label: "Gender" },
                      { key: "fatherName", label: "Father's Name *" },
                      { key: "motherName", label: "Mother's Name" },
                      { key: "mobileNumber", label: "Mobile Number" },
                      { key: "email", label: "Email" },
                      { key: "classApplying", label: "Class Applying For *" },
                      { key: "previousSchool", label: "Previous School" },
                      { key: "previousClass", label: "Previous Class" },
                    ].map(({ key, label }) => (
                      <div key={key} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <label style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 500 }}>{label}</label>
                        <input className="input" value={(formData as any)[key]} onChange={e => setFormData(prev => ({ ...prev, [key]: e.target.value }))}
                          placeholder={label} />
                      </div>
                    ))}
                    {[
                      { key: "address", label: "Address", full: true },
                    ].map(({ key, label }) => (
                      <div key={key} style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "2px" }}>
                        <label style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 500 }}>{label}</label>
                        <textarea className="input" value={(formData as any)[key]} onChange={e => setFormData(prev => ({ ...prev, [key]: e.target.value }))}
                          placeholder={label} rows={2} style={{ resize: "vertical" }} />
                      </div>
                    ))}
                  </div>

                  {/* Submitted docs summary */}
                  {docs.filter(d => d.result).length > 0 && (
                    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--border-light)" }}>
                      <div style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: "6px" }}>Documents Submitted</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        {docs.filter(d => d.result).map(d => {
                          const p = d.result!.parsed;
                          return (
                            <div key={d.id} style={{ fontSize: "0.72rem", display: "flex", gap: "8px" }}>
                              <span className="badge badge-success" style={{ fontSize: "0.55rem", flexShrink: 0 }}>{p.documentType || "Doc"}</span>
                              <span>{d.file.name}</span>
                              {p.documentNumber && <span style={{ color: "var(--text-muted)" }}>#{p.documentNumber}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
