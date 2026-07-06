import type { DocumentFields } from "./schema";

export interface FieldEntry {
  field: string;
  label: string;
  values: { docId: number; docName: string; value: string }[];
  agreed: boolean;
  agreedValue: string | null;
  source: string;
}

export interface ReconciledData {
  name: string;
  dateOfBirth: string;
  fatherName: string;
  motherName: string;
  gender: string;
  address: string;
  mobileNumber: string;
  email: string;
  documentNumber: string;
}

const FIELD_MAP: { key: keyof ReconciledData; label: string; sourceKey: ("name"|"dateOfBirth"|"fatherName"|"motherName"|"gender"|"address"|"mobileNumber"|"email"|"documentNumber")[] }[] = [
  { key: "name", label: "Student Name", sourceKey: ["name"] },
  { key: "dateOfBirth", label: "Date of Birth", sourceKey: ["dateOfBirth"] },
  { key: "fatherName", label: "Father's Name", sourceKey: ["fatherName"] },
  { key: "motherName", label: "Mother's Name", sourceKey: ["motherName"] },
  { key: "gender", label: "Gender", sourceKey: ["gender"] },
  { key: "address", label: "Address", sourceKey: ["address"] },
  { key: "mobileNumber", label: "Mobile Number", sourceKey: ["mobileNumber"] },
  { key: "email", label: "Email", sourceKey: ["email"] },
  { key: "documentNumber", label: "Document Number", sourceKey: ["documentNumber"] },
];

export function reconcileDocuments(docs: { id: number; name: string; fields: DocumentFields }[]): {
  entries: FieldEntry[];
  reconciled: ReconciledData;
  hasMismatches: boolean;
} {
  const entries: FieldEntry[] = [];
  let hasMismatches = false;

  for (const fm of FIELD_MAP) {
    const values: { docId: number; docName: string; value: string }[] = [];

    for (const doc of docs) {
      for (const sk of fm.sourceKey) {
        const val = doc.fields[sk] as string | undefined;
        if (val && val.trim()) {
          values.push({ docId: doc.id, docName: doc.name, value: val.trim() });
        }
      }
    }

    if (values.length === 0) {
      entries.push({ field: fm.key, label: fm.label, values, agreed: true, agreedValue: null, source: "not found" });
      continue;
    }

    const uniqueVals = [...new Set(values.map(v => v.value.toLowerCase()))];
    const agreed = uniqueVals.length === 1;
    if (!agreed) hasMismatches = true;

    const agreedValue = agreed ? values[0].value : null;

    // Find which documents provide this field
    const sourceDocTypes = values.map(v => v.docName).join(", ");
    const source = values.length > 0 ? `Found in: ${sourceDocTypes}` : "not found";

    entries.push({ field: fm.key, label: fm.label, values, agreed, agreedValue, source });
  }

  // Build ReconciledData - use the most common value or first value for each field
  const pickValue = (entry: FieldEntry): string => {
    if (entry.agreedValue) return entry.agreedValue;
    if (entry.values.length === 0) return "";
    // Return the most frequent value
    const freq: Record<string, number> = {};
    for (const v of entry.values) {
      const low = v.value.toLowerCase();
      freq[low] = (freq[low] || 0) + 1;
    }
    const mostFreq = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    return entry.values.find(v => v.value.toLowerCase() === mostFreq[0])?.value || entry.values[0].value;
  };

  const reconciled: ReconciledData = {
    name: pickValue(entries.find(e => e.field === "name")!),
    dateOfBirth: pickValue(entries.find(e => e.field === "dateOfBirth")!),
    fatherName: pickValue(entries.find(e => e.field === "fatherName")!),
    motherName: pickValue(entries.find(e => e.field === "motherName")!),
    gender: pickValue(entries.find(e => e.field === "gender")!),
    address: pickValue(entries.find(e => e.field === "address")!),
    mobileNumber: pickValue(entries.find(e => e.field === "mobileNumber")!),
    email: pickValue(entries.find(e => e.field === "email")!),
    documentNumber: pickValue(entries.find(e => e.field === "documentNumber")!),
  };

  return { entries, reconciled, hasMismatches };
}
