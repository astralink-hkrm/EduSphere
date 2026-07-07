import type { DocumentFields } from "./schema";

export interface DocFieldValue {
  docId: number;
  docName: string;
  value: string;
}

export interface FieldReconciliation {
  field: string;
  label: string;
  values: DocFieldValue[];
  agreed: boolean;
  selectedValue: string;
  selectedDocId: number | null;
  manuallyEdited: boolean;
}

export interface ReconciliationResult {
  fields: FieldReconciliation[];
  hasMismatches: boolean;
  allFields: string[];
}

export const FIELD_DEFS: { key: string; label: string }[] = [
  { key: "name", label: "Student Name" },
  { key: "dateOfBirth", label: "Date of Birth" },
  { key: "fatherName", label: "Father's Name" },
  { key: "motherName", label: "Mother's Name" },
  { key: "gender", label: "Gender" },
  { key: "address", label: "Address" },
  { key: "mobileNumber", label: "Mobile Number" },
  { key: "email", label: "Email" },
  { key: "documentNumber", label: "Document Number" },
];

export function reconcileDocuments(
  docs: { id: number; name: string; fields: DocumentFields }[]
): ReconciliationResult {
  const fields: FieldReconciliation[] = [];
  let hasMismatches = false;

  for (const fd of FIELD_DEFS) {
    const values: DocFieldValue[] = [];
    for (const doc of docs) {
      const val = (doc.fields as unknown as Record<string, string | undefined>)[fd.key];
      if (val && typeof val === "string" && val.trim()) {
        values.push({ docId: doc.id, docName: doc.name, value: val.trim() });
      }
    }

    const uniqueVals = [...new Set(values.map((v) => v.value.toLowerCase()))];
    const agreed = values.length > 0 && uniqueVals.length === 1;
    if (!agreed && values.length > 0) hasMismatches = true;

    const selectedValue = values.length > 0 ? values[0].value : "";

    fields.push({
      field: fd.key,
      label: fd.label,
      values,
      agreed,
      selectedValue,
      selectedDocId: values.length > 0 ? values[0].docId : null,
      manuallyEdited: false,
    });
  }

  return { fields, hasMismatches, allFields: FIELD_DEFS.map((f) => f.key) };
}

export function buildFormData(
  fields: FieldReconciliation[]
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const f of fields) {
    data[f.field] = f.selectedValue || "";
  }
  return data;
}
