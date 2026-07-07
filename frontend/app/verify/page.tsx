"use client";
import { useState, useRef, useCallback } from "react";
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Stepper,
  Step,
  StepLabel,
  Grid,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  IconButton,
  InputAdornment,
  Alert,
  Tooltip,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DescriptionIcon from "@mui/icons-material/Description";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { DocumentFields } from "../schema";
import { DocumentFieldsSchema } from "../schema";
import { preprocessImage, type PreprocessResult } from "../preprocess";
import {
  reconcileDocuments,
  FIELD_DEFS,
  buildFormData,
  type ReconciliationResult,
} from "../reconcile";
import { saveVerification } from "../lib/storage";

const MODELS = [
  { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite", provider: "Google", modelId: "gemini-2.0-flash-lite", costIn: 0.075, costOut: 0.30 },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "Google", modelId: "gemini-2.0-flash", costIn: 0.10, costOut: 0.40 },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google", modelId: "gemini-2.5-flash", costIn: 0.15, costOut: 0.60 },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "Google", modelId: "gemini-2.5-pro", costIn: 1.25, costOut: 5.00 },
  { id: "groq", name: "Llama 4 Scout", provider: "Groq", modelId: "meta-llama/llama-4-scout-17b-16e-instruct", costIn: 0, costOut: 0 },
];

const getLocal = (key: string, fallback: string) => {
  if (typeof window === "undefined") return fallback;
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};

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

const REQUIRED_DOCS = [
  { key: "aadhaar", label: "Aadhaar Card" },
  { key: "birth", label: "Birth Certificate" },
  { key: "tc", label: "Transfer Certificate" },
  { key: "marksheet", label: "Mark Sheet / Report Card" },
  { key: "photo", label: "Passport-size Photo" },
];

const STEPS = ["Upload Documents", "AI Analysis", "Cross-check & Reconcile", "Admission Form"];

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

async function callGemini(base64: string, apiKey: string, modelId: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SYSTEM_PROMPT }, { inline_data: { mime_type: "image/jpeg", data: base64.split(",")[1] } }] }],
      }),
    }
  );
  if (res.status === 429) throw new Error("Gemini API rate limit exceeded (429).");
  if (!res.ok) throw new Error(`Gemini error (${res.status}): ${(await res.text()).slice(0, 100)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const meta = data?.usageMetadata || {};
  return {
    text,
    usage: { promptTokens: meta.promptTokenCount || 0, completionTokens: meta.candidatesTokenCount || 0, totalTokens: meta.totalTokenCount || 0 },
  };
}

async function callGroq(base64: string, apiKey: string, modelId: string) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: [{ type: "text", text: SYSTEM_PROMPT }, { type: "image_url", image_url: { url: base64 } }] }],
      max_tokens: 2048,
    }),
  });
  if (res.status === 429) throw new Error("Groq API rate limit exceeded (429).");
  if (!res.ok) throw new Error(`Groq error (${res.status}): ${(await res.text()).slice(0, 100)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  const usage = data?.usage || {};
  return {
    text,
    usage: { promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0, totalTokens: usage.total_tokens || 0 },
  };
}

function extractJson(text: string): string {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : text;
}

export default function VerifyPage() {
  const [step, setStep] = useState(0);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [selectedModel] = useState(() => getLocal("selected_model", "gemini-2.0-flash-lite"));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [batchResults, setBatchResults] = useState<{ totalTokens: number; totalCost: number } | null>(null);
  const [reconResult, setReconResult] = useState<ReconciliationResult | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [selectedValues, setSelectedValues] = useState<Record<string, { value: string; docId: number | null; manual: boolean }>>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const [geminiKey] = useState(() => {
    if (typeof window === "undefined") return "";
    try { return localStorage.getItem("gemini_key") || ""; } catch { return ""; }
  });
  const [groqKey] = useState(() => {
    if (typeof window === "undefined") return "";
    try { return localStorage.getItem("groq_key") || ""; } catch { return ""; }
  });

  const completedDocs = docs.filter((d) => d.result);
  const allDone = completedDocs.length === docs.length && docs.length > 0;

  const addFiles = useCallback((files: FileList) => {
    Array.from(files).forEach((file, i) => {
      const reader = new FileReader();
      const id = Date.now() + i;
      reader.onload = () => {
        setDocs((prev) => [...prev, { id, file, preview: reader.result as string, processed: null, loading: false, error: null, result: null, validationErrors: [] }]);
      };
      reader.readAsDataURL(file);
    });
    setReconResult(null);
  }, []);

  const removeDoc = useCallback((id: number) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    setReconResult(null);
  }, []);

  const processAll = useCallback(async () => {
    if (docs.length === 0 || running) return;
    setRunning(true);
    setProgress(0);
    setBatchResults(null);
    setReconResult(null);

    const model = MODELS.find((m) => m.id === selectedModel)!;
    const key = model.provider === "Google" ? geminiKey : groqKey;
    if (!key) { setRunning(false); return; }

    let totalTokens = 0;
    let totalCost = 0;
    const results: { id: number; name: string; fields: DocumentFields }[] = [];

    for (let idx = 0; idx < docs.length; idx++) {
      const doc = docs[idx];
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, loading: true, error: null, result: null } : d)));
      try {
        const processed = await preprocessImage(doc.preview);
        setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, processed } : d)));

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
          else { parsed = raw as DocumentFields; validationErrors.push(...validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)); }
        } catch {
          parsed = { documentType: "Unknown" };
          validationErrors.push("Failed to parse model response as JSON");
        }

        const cost = (usage.promptTokens * model.costIn + usage.completionTokens * model.costOut) / 1_000_000;
        totalTokens += usage.totalTokens;
        totalCost += cost;

        setDocs((prev) => prev.map((d) => d.id === doc.id ? { ...d, loading: false, result: { rawText: text, parsed, usage, cost }, validationErrors } : d));
        if (parsed.documentType !== "Unknown" || Object.keys(parsed).length > 1) {
          results.push({ id: doc.id, name: doc.file.name, fields: parsed });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Analysis failed";
        setDocs((prev) => prev.map((d) => d.id === doc.id ? { ...d, loading: false, error: msg } : d));
      }
      setProgress(((idx + 1) / docs.length) * 100);
    }

    setBatchResults({ totalTokens, totalCost });

    if (results.length >= 2) {
      const result = reconcileDocuments(results);
      setReconResult(result);
      const initial: Record<string, { value: string; docId: number | null; manual: boolean }> = {};
      for (const f of result.fields) {
        initial[f.field] = { value: f.selectedValue, docId: f.selectedDocId, manual: f.manuallyEdited };
      }
      setSelectedValues(initial);
      setFormData(buildFormData(result.fields));
    }

    setRunning(false);
  }, [docs, running, selectedModel, geminiKey, groqKey]);

  const toggleRow = (field: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const selectValue = (field: string, value: string, docId: number) => {
    setSelectedValues((prev) => ({ ...prev, [field]: { value, docId, manual: false } }));
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (reconResult) {
      setReconResult((prev) => {
        if (!prev) return prev;
        return { ...prev, fields: prev.fields.map((f) => f.field === field ? { ...f, selectedValue: value, selectedDocId: docId, manuallyEdited: false } : f) };
      });
    }
  };

  const manualEdit = (field: string, value: string) => {
    setSelectedValues((prev) => ({ ...prev, [field]: { value, docId: null, manual: true } }));
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (reconResult) {
      setReconResult((prev) => {
        if (!prev) return prev;
        return { ...prev, fields: prev.fields.map((f) => f.field === field ? { ...f, selectedValue: value, selectedDocId: null, manuallyEdited: true } : f) };
      });
    }
  };

  const counterRef = useRef(0);

  const handleComplete = () => {
    counterRef.current += 1;
    const name = formData.name || "Untitled";
    const mismatchCount = reconResult ? reconResult.fields.filter((f) => !f.agreed && f.values.length > 0).length : 0;
    saveVerification({
      id: `v${counterRef.current}`,
      timestamp: counterRef.current,
      studentName: name,
      docCount: completedDocs.length,
      mismatchCount,
      status: mismatchCount > 0 ? "mismatch" : "verified",
    });
  };

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, fontSize: "1.6rem", mb: 0.5 }}>
          Document Verification
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Upload student documents, extract data, cross-check, and generate admission form
        </Typography>
      </Box>

      <Stepper activeStep={step} alternativeLabel sx={{ mb: 4, "& .MuiStepLabel-root .Mui-completed": { color: "success.main" } }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {running && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">Processing documents...</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>{Math.round(progress)}%</Typography>
          </Box>
          <LinearProgress variant="determinate" value={progress} />
        </Box>
      )}

      {/* Step 0: Upload */}
      {step === 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: "0.95rem", fontWeight: 600, mb: 2 }}>
                Required Documents Checklist
              </Typography>
              <List disablePadding>
                {REQUIRED_DOCS.map((rd) => {
                  const provided = docs.some((d) => d.file.name.toLowerCase().includes(rd.key));
                  return (
                    <ListItem key={rd.key} disableGutters sx={{ py: 0.75 }}>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        {provided ? (
                          <CheckCircleIcon sx={{ color: "success.main", fontSize: 20 }} />
                        ) : (
                          <CancelIcon sx={{ color: "error.main", fontSize: 20 }} />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        primary={rd.label}
                        sx={{ "& .MuiListItemText-primary": { fontSize: "0.85rem", fontWeight: 500 } }}
                      />
                      {provided && <Chip label="Uploaded" size="small" color="success" variant="outlined" />}
                    </ListItem>
                  );
                })}
              </List>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
                <Typography variant="h6" sx={{ fontSize: "0.95rem", fontWeight: 600 }}>
                  Upload Documents
                </Typography>
                <Button size="small" variant="outlined" startIcon={<CloudUploadIcon />} onClick={() => fileRef.current?.click()}>
                  Add Files
                </Button>
              </Box>

              <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => e.target.files && addFiles(e.target.files)} />

              <Box
                className="upload-zone"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
                sx={{ mb: docs.length > 0 ? 2 : 0 }}
              >
                <CloudUploadIcon sx={{ fontSize: 48, color: "text.secondary", mb: 1 }} />
                <Typography variant="body1" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Drop documents here or click to browse
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Supports: Aadhaar, Birth Certificate, Transfer Certificate, Mark Sheet, Photos
                </Typography>
              </Box>

              {docs.length > 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {docs.map((doc) => (
                    <Paper
                      key={doc.id}
                      variant="outlined"
                      sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1.5, borderRadius: 2 }}
                    >
                      <Box
                        component="img"
                        src={doc.preview}
                        sx={{ width: 44, height: 44, objectFit: "cover", borderRadius: 1, border: "1px solid", borderColor: "divider" }}
                      />
                      <Typography variant="body2" sx={{ flex: 1, fontWeight: 500, fontSize: "0.82rem" }}>
                        {doc.file.name}
                      </Typography>
                      <IconButton size="small" onClick={() => removeDoc(doc.id)} color="error">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Paper>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 1 }}>
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button size="small" variant="outlined" onClick={() => { setDocs([]); setBatchResults(null); setReconResult(null); }} disabled={docs.length === 0}>
                  Clear All
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                  onClick={() => { processAll().then(() => { if (docs.length > 0) setStep(1); }); }}
                  disabled={docs.length === 0 || running}
                >
                  {running ? "Processing..." : "Analyze All"}
                </Button>
              </Box>
            </Box>
          </Paper>
        </Box>
      )}

      {/* Step 1: Analysis */}
      {step === 1 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {batchResults && (
            <Paper variant="outlined" sx={{ p: 1.5, px: 2, borderRadius: 2, display: "flex", gap: 2, alignItems: "center" }}>
              <Typography variant="caption" color="text.secondary"><strong>{docs.length}</strong> documents</Typography>
              <Typography variant="caption" color="text.secondary">|</Typography>
              <Typography variant="caption" color="text.secondary"><strong>{batchResults.totalTokens}</strong> tokens</Typography>
              <Typography variant="caption" color="text.secondary">|</Typography>
              <Typography variant="caption" color="text.secondary">Cost: <strong>${batchResults.totalCost.toFixed(6)}</strong></Typography>
            </Paper>
          )}

          {docs.map((doc) => (
            <Card key={doc.id}>
              <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
                  <Box
                    component="img"
                    src={doc.preview}
                    sx={{ width: 40, height: 40, objectFit: "cover", borderRadius: 1, border: "1px solid", borderColor: "divider" }}
                  />
                  <Typography variant="body2" sx={{ flex: 1, fontWeight: 600, fontSize: "0.85rem" }}>
                    {doc.file.name}
                  </Typography>
                  {doc.loading && <Chip label="Processing" size="small" color="info" variant="outlined" />}
                  {doc.error && <Chip label="Error" size="small" color="error" variant="outlined" />}
                  {doc.result && (
                    <Chip
                      label={doc.result.parsed.documentType || "Extracted"}
                      size="small"
                      color="success"
                      variant="outlined"
                    />
                  )}
                </Box>

                {doc.loading && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "warning.main", className: "animate-pulse" }} />
                    <Typography variant="caption" color="text.secondary">Extracting data...</Typography>
                  </Box>
                )}
                {doc.error && (
                  <Alert severity="error" sx={{ py: 0, "& .MuiAlert-message": { fontSize: "0.78rem" } }}>
                    {doc.error}
                  </Alert>
                )}
                {doc.result && (
                  <>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                      {doc.result.usage.totalTokens} tokens &middot; ${doc.result.cost.toFixed(6)}
                    </Typography>
                    <Grid container spacing={0.5}>
                      {FIELD_DEFS.map((fd) => {
                        const val = (doc.result!.parsed as unknown as Record<string, string | undefined>)[fd.key];
                        return val ? (
                          <Grid key={fd.key} size={{ xs: 6, sm: 4, md: 3 }}>
                            <Box sx={{ fontSize: "0.75rem" }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.68rem" }}>
                                {fd.label}
                              </Typography>
                              <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.8rem" }}>
                                {val}
                              </Typography>
                            </Box>
                          </Grid>
                        ) : null;
                      })}
                      {doc.result.parsed.additionalFields &&
                        Object.entries(doc.result.parsed.additionalFields).map(([k, v]) => (
                          <Grid key={k} size={{ xs: 6, sm: 4, md: 3 }}>
                            <Box sx={{ fontSize: "0.75rem" }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.68rem" }}>
                                {k}
                              </Typography>
                              <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.8rem" }}>
                                {v}
                              </Typography>
                            </Box>
                          </Grid>
                        ))}
                    </Grid>
                  </>
                )}
              </CardContent>
            </Card>
          ))}

          <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => setStep(0)} variant="outlined">
              Back to Upload
            </Button>
            <Button
              endIcon={<ArrowForwardIcon />}
              onClick={() => setStep(2)}
              variant="contained"
              disabled={!allDone}
            >
              {allDone ? "Continue to Cross-check" : "Waiting for analysis..."}
            </Button>
          </Box>
        </Box>
      )}

      {/* Step 2: Reconciliation */}
      {step === 2 && reconResult && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Card>
            <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
              <Box sx={{ px: 2.5, py: 2, borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 1.5 }}>
                <Typography variant="h6" sx={{ fontSize: "0.95rem", fontWeight: 600, flex: 1 }}>
                  Cross-Document Field Comparison
                </Typography>
                {reconResult.hasMismatches ? (
                  <Chip icon={<WarningAmberIcon />} label="Contradictions Found" size="small" color="warning" variant="outlined" />
                ) : (
                  <Chip icon={<CheckCircleIcon />} label="All Fields Match" size="small" color="success" variant="outlined" />
                )}
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ minWidth: 130 }}>Field</TableCell>
                      {completedDocs.map((doc) => (
                        <TableCell key={doc.id} align="center" sx={{ minWidth: 120 }}>
                          <Typography variant="caption" sx={{ fontSize: "0.6rem", color: "text.secondary", display: "block" }}>
                            {doc.result?.parsed.documentType || "Document"}
                          </Typography>
                          <Typography variant="caption" sx={{ fontSize: "0.6rem", color: "text.secondary", display: "block" }}>
                            {doc.file.name.length > 18 ? doc.file.name.slice(0, 16) + ".." : doc.file.name}
                          </Typography>
                        </TableCell>
                      ))}
                      <TableCell align="center" sx={{ minWidth: 120, bgcolor: "primary.light" }}>Selected Value</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {reconResult.fields.filter((f) => f.values.length > 0).map((field) => {
                      const isExpanded = expandedRows.has(field.field);
                      const sv = selectedValues[field.field];
                      return (
                        <>
                          <TableRow key={field.field} hover sx={{ "&:hover": { cursor: "pointer" } }} onClick={() => toggleRow(field.field)}>
                            <TableCell>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                {isExpanded ? <ExpandMoreIcon fontSize="small" color="action" /> : <ChevronRightIcon fontSize="small" color="action" />}
                                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.8rem" }}>
                                  {field.label}
                                </Typography>
                              </Box>
                            </TableCell>
                            {completedDocs.map((doc) => {
                              const dv = field.values.find((v) => v.docId === doc.id);
                              const allSame = field.values.length > 0 && field.values.every((v) => v.value.toLowerCase() === field.values[0].value.toLowerCase());
                              if (!dv) return <TableCell key={doc.id} align="center"><Typography variant="caption" color="text.disabled">--</Typography></TableCell>;
                              return (
                                <TableCell
                                  key={doc.id}
                                  align="center"
                                  onClick={(e) => { e.stopPropagation(); selectValue(field.field, dv.value, dv.docId); }}
                                  sx={{
                                    bgcolor: sv?.value === dv.value ? "primary.light" : "transparent",
                                    cursor: "pointer",
                                    "&:hover": { bgcolor: "action.hover" },
                                  }}
                                >
                                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5 }}>
                                    {!allSame && field.values.length > 0 ? (
                                      <CancelIcon sx={{ color: "error.main", fontSize: 16 }} />
                                    ) : (
                                      <CheckCircleIcon sx={{ color: "success.main", fontSize: 16 }} />
                                    )}
                                    <Typography variant="body2" sx={{ fontWeight: sv?.value === dv.value ? 600 : 400, fontSize: "0.8rem" }}>
                                      {dv.value}
                                    </Typography>
                                  </Box>
                                </TableCell>
                              );
                            })}
                            <TableCell align="center" sx={{ bgcolor: "primary.light" }}>
                              {sv?.manual ? (
                                <TextField
                                  size="small"
                                  value={sv.value}
                                  onChange={(e) => manualEdit(field.field, e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  sx={{ "& .MuiInputBase-input": { textAlign: "center", fontSize: "0.78rem", py: 0.5 } }}
                                  autoFocus
                                />
                              ) : (
                                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.82rem", color: "primary.main" }}>
                                  {sv?.value || "---"}
                                </Typography>
                              )}
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow>
                              <TableCell colSpan={completedDocs.length + 3} sx={{ py: 1.5, px: 4 }}>
                                <Box>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: "block", mb: 1 }}>
                                    All extracted values
                                  </Typography>
                                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                                    {field.values.map((v, i) => (
                                      <Paper
                                        key={i}
                                        variant="outlined"
                                        onClick={() => selectValue(field.field, v.value, v.docId)}
                                        sx={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 1,
                                          p: 1,
                                          borderRadius: 1,
                                          cursor: "pointer",
                                          borderColor: sv?.value === v.value ? "primary.main" : "divider",
                                          bgcolor: sv?.value === v.value ? "primary.light" : "background.paper",
                                          "&:hover": { borderColor: "primary.main" },
                                        }}
                                      >
                                        <CheckCircleIcon sx={{ color: sv?.value === v.value ? "success.main" : "action.disabled", fontSize: 18 }} />
                                        <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.8rem" }}>{v.value}</Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                                          from {v.docName.replace(/\.[^/.]+$/, "")}
                                        </Typography>
                                      </Paper>
                                    ))}
                                    <Paper variant="outlined" sx={{ display: "flex", alignItems: "center", gap: 1, p: 1, borderRadius: 1 }}>
                                      <EditIcon sx={{ color: "action.disabled", fontSize: 18 }} />
                                      <TextField
                                        size="small"
                                        placeholder="Enter custom value..."
                                        value={sv?.manual ? sv.value : ""}
                                        onChange={(e) => manualEdit(field.field, e.target.value)}
                                        sx={{ flex: 1, "& .MuiInputBase-input": { fontSize: "0.78rem", py: 0.5 } }}
                                      />
                                      <Typography variant="caption" color="text.secondary">Manual entry</Typography>
                                    </Paper>
                                  </Box>
                                </Box>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              {reconResult.hasMismatches && (
                <Box sx={{ px: 2.5, py: 1.5 }}>
                  <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ "& .MuiAlert-message": { fontSize: "0.78rem" } }}>
                    Contradictions detected. Click on any value in the table to select it, or use the manual entry to enter a custom value.
                  </Alert>
                </Box>
              )}
            </CardContent>
          </Card>

          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => setStep(1)} variant="outlined">
              Back to Analysis
            </Button>
            <Button endIcon={<ArrowForwardIcon />} onClick={() => setStep(3)} variant="contained">
              Generate Admission Form
            </Button>
          </Box>
        </Box>
      )}

      {step === 2 && !reconResult && (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <DescriptionIcon sx={{ fontSize: 48, color: "divider", mb: 1 }} />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Process at least 2 documents to see cross-document comparison.
            </Typography>
            <Button startIcon={<ArrowBackIcon />} onClick={() => setStep(1)} variant="outlined">
              Back to Analysis
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Form */}
      {step === 3 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5 }}>
                <Typography variant="h6" sx={{ fontSize: "0.95rem", fontWeight: 600 }}>
                  Admission Form
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={<ContentCopyIcon />}
                  onClick={() => {
                    const lines = ["SCHOOL ADMISSION FORM", "====================", "",
                      ...FIELD_DEFS.filter((f) => formData[f.key]).map((f) => `${f.label}: ${formData[f.key]}`),
                      "", "Documents Submitted:",
                      ...completedDocs.map((d) => `  - ${d.result!.parsed.documentType || "Document"} (${d.file.name}): ${d.result!.parsed.documentNumber || "N/A"}`),
                    ].join("\n");
                    navigator.clipboard.writeText(lines);
                  }}
                >
                  <ContentCopyIcon sx={{ fontSize: 16, mr: 0.5 }} />
                  Copy Form
                </Button>
              </Box>

              <Grid container spacing={2}>
                {FIELD_DEFS.filter((f) => f.key !== "documentNumber").map((fd) => {
                  const sv = selectedValues[fd.key];
                  const hasConflict = reconResult?.fields.find((f) => f.field === fd.key)?.values.length &&
                    !reconResult?.fields.find((f) => f.field === fd.key)?.agreed;
                  return (
                    <Grid key={fd.key} size={{ xs: 12, sm: fd.key === "address" ? 12 : 6 }}>
                      <TextField
                        fullWidth
                        label={fd.label}
                        value={formData[fd.key] || ""}
                        onChange={(e) => { setFormData((prev) => ({ ...prev, [fd.key]: e.target.value })); manualEdit(fd.key, e.target.value); }}
                        size="small"
                        multiline={fd.key === "address"}
                        rows={fd.key === "address" ? 2 : 1}
                        slotProps={{
                          inputLabel: { shrink: true },
                          input: {
                            endAdornment: hasConflict ? (
                              <InputAdornment position="end">
                                <Tooltip title="Contradicting values from documents">
                                  <WarningAmberIcon sx={{ color: "warning.main", fontSize: 18 }} />
                                </Tooltip>
                              </InputAdornment>
                            ) : sv?.manual ? (
                              <InputAdornment position="end">
                                <Tooltip title="Manually edited">
                                  <EditIcon sx={{ color: "action.disabled", fontSize: 16 }} />
                                </Tooltip>
                              </InputAdornment>
                            ) : undefined,
                          },
                        }}
                      />
                    </Grid>
                  );
                })}
              </Grid>

              <Box sx={{ mt: 3, pt: 2, borderTop: "1px solid", borderColor: "divider" }}>
                <Typography variant="h6" sx={{ fontSize: "0.85rem", fontWeight: 600, mb: 1.5 }}>
                  Submitted Documents
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                  {completedDocs.map((d) => {
                    const p = d.result!.parsed;
                    return (
                      <Paper key={d.id} variant="outlined" sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1.5, borderRadius: 1.5 }}>
                        <Chip label={p.documentType || "Document"} size="small" color="success" variant="outlined" sx={{ fontSize: "0.6rem" }} />
                        <Typography variant="body2" sx={{ flex: 1, fontWeight: 500, fontSize: "0.8rem" }}>
                          {d.file.name}
                        </Typography>
                        {p.documentNumber && (
                          <Typography variant="caption" color="text.secondary">
                            #{p.documentNumber}
                          </Typography>
                        )}
                      </Paper>
                    );
                  })}
                </Box>
              </Box>
            </CardContent>
          </Card>

          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => setStep(2)} variant="outlined">
              Back to Cross-check
            </Button>
            <Button
              variant="contained"
              color="success"
              startIcon={<ContentCopyIcon />}
              onClick={() => {
                handleComplete();
                const output = ["=== ADMISSION FORM SUMMARY ===", "",
                  ...FIELD_DEFS.filter((f) => formData[f.key]).map((f) => `${f.label}: ${formData[f.key]}`),
                  "", "=== DOCUMENTS ===", ...completedDocs.map((d) => `- ${d.file.name}`),
                ].join("\n");
                navigator.clipboard.writeText(output);
              }}
            >
              Complete & Export
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
