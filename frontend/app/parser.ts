/**
 * TypeScript Parser Engine for Indian Government Documents
 * Ported from python/parser.py
 */

export interface ParsedData {
  document_type: "PAN" | "Aadhaar" | "Nivas" | "Unknown";
  fields: {
    name: string;
    fathers_name: string;
    dob: string;
    doc_number: string;
    address: string;
  };
}

function cleanLines(text: string): string[] {
  const lines: string[] = [];
  text.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.length > 1) {
      lines.push(trimmed);
    }
  });
  return lines;
}

export function classifyDocument(text: string): "PAN" | "Aadhaar" | "Nivas" | "Unknown" {
  const textLower = text.toLowerCase();
  
  if (["permanent", "account number", "tax department", "आयकर", "pan card"].some(k => textLower.includes(k))) {
    return "PAN";
  }
  
  if (["aadhaar", "adhar", "uidai", "आधार", "authentication", "unique"].some(k => textLower.includes(k))) {
    return "Aadhaar";
  }
  
  if (["निवास", "निवासप्रमाणपत्र", "pramanpatra", "निगाग", "प्रणाण", "तहसीलदार", "अजमेर", "ajmer"].some(k => textLower.includes(k))) {
    return "Nivas";
  }
  
  return "Unknown";
}

function cleanPanNumber(text: string): string {
  const cleanedText = text.replace(/[|/\\_ \-]/g, "");
  // Match any 8 to 12-char alphanumeric chunks
  const candidates = cleanedText.toUpperCase().match(/\b([A-Z0-9]{8,12})\b/g) || [];
  for (const c of candidates) {
    const digitCount = c.split("").filter(char => !isNaN(Number(char))).length;
    if (digitCount >= 2 && digitCount <= 6) {
      return c;
    }
  }
  return "";
}

export function parseOCRResult(text: string): ParsedData {
  const docType = classifyDocument(text);
  const lines = cleanLines(text);
  const data = {
    name: "",
    fathers_name: "",
    dob: "",
    doc_number: "",
    address: ""
  };

  // Find general Dates of Birth (dd/mm/yyyy or dd-mm-yyyy)
  const dobMatch = text.match(/\b(\d{2}[/\-]\d{2}[/\-]\d{4})\b/);
  if (dobMatch) {
    data.dob = dobMatch[1];
  }

  if (docType === "PAN") {
    data.doc_number = cleanPanNumber(text);

    for (let i = 0; i < lines.length; i++) {
      const lineUpper = lines[i].toUpperCase();
      if ((lineUpper === "NANE" || lineUpper === "NAME" || lines[i] === "ना" || lines[i].includes("नाम")) && !lineUpper.includes("FATHER") && !lines[i].includes("पिता")) {
        for (let offset = 1; offset <= 3; offset++) {
          if (i + offset < lines.length) {
            const candidate = lines[i + offset];
            const candUpper = candidate.toUpperCase();
            if (!["NAME", "NANE", "FATHER", "DOB", "DATE", "CARD", "NUMBER", "आयकर", "विभाग", "सरकार"].some(k => candUpper.includes(k))) {
              data.name = candidate;
              break;
            }
          }
        }
        if (data.name) continue;
      }

      if (lineUpper.includes("FATHER") || lines[i].includes("पिता")) {
        for (let offset = 1; offset <= 3; offset++) {
          if (i + offset < lines.length) {
            const candidate = lines[i + offset];
            const candUpper = candidate.toUpperCase();
            if (!["NAME", "NANE", "FATHER", "DOB", "DATE", "CARD", "NUMBER", "आयकर", "विभाग", "सरकार"].some(k => candUpper.includes(k))) {
              data.fathers_name = candidate;
              break;
            }
          }
        }
      }
    }
  } else if (docType === "Aadhaar") {
    const cleanText = text.replace(/[^0-9\s]/g, "");
    const digitsMatch = cleanText.match(/\b(\d{4}\s\d{4}\s\d{4})\b/);
    if (digitsMatch) {
      data.doc_number = digitsMatch[1];
    } else {
      const contiguous = cleanText.match(/\b(\d{12})\b/);
      if (contiguous) {
        const d = contiguous[1];
        data.doc_number = `${d.substring(0, 4)} ${d.substring(4, 8)} ${d.substring(8)}`;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toUpperCase().includes("DOB") || lines[i].includes("जन्म") || lines[i].toUpperCase().includes("BIRTH")) {
        if (i - 1 >= 0) {
          data.name = lines[i - 1];
          break;
        }
      }
    }
  } else if (docType === "Nivas") {
    const cleanTextUpper = text.toUpperCase().replace(/\s/g, "");
    const certMatch = cleanTextUpper.match(/\b(RJ\/[A-Z0-9/_\-]+)\b/);
    if (certMatch) {
      data.doc_number = certMatch[1];
    } else {
      const numbers = text.match(/\b(\d{10,})\b/g) || [];
      if (numbers.length > 0) {
        data.doc_number = numbers[0] || "";
      }
    }

    // Line-by-line scanning using unicode Devanagari range matching
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Name line search
      if (line.includes("प्रमाणित किया जाता") || line.includes("प्रमाणित")) {
        const candidatesList = [line, i + 1 < lines.length ? lines[i + 1] : ""];
        for (const cand of candidatesList) {
          const nameSearch = cand.match(/(?:श्री|शी|की)\s*([\u0900-\u097F\s]+)/);
          if (nameSearch) {
            let nameVal = nameSearch[1].trim();
            // Remove trailing verbs
            nameVal = nameVal.replace(/(?:पुत्र|पुत्री|पुन्न|पत्नी|निवास|नियाम|मदिर|है|था|हैं|$).*$/, "").trim();
            if (nameVal) {
              data.name = nameVal;
              break;
            }
          }
        }
      }

      // Father's name line search
      if (["पुत्र", "पुत्री", "पुन्न", "पुन्नी", "पत्नी"].some(k => line.includes(k))) {
        const fatherSearch = line.match(/(?:श्री|शी|शरी)\s*([\u0900-\u097F\s]+)/);
        if (fatherSearch) {
          let fatherVal = fatherSearch[1].trim();
          fatherVal = fatherVal.replace(/(?:निवास|नियाम|है|था|$).*$/, "").trim();
          if (fatherVal) {
            data.fathers_name = fatherVal;
          }
        }
      }

      // Address line search
      if (line.includes("निवास") || line.includes("नियाम") || line.includes("निवासी")) {
        let addrVal = line.replace(/^.*?(?:निवास|नियाम|निवासी)\s*[\-\:]?\s*/, "").trim();
        addrVal = addrVal.replace(/(?:है|हैं|प्रमाणित|$).*$/, "").trim();
        if (addrVal.length > 4) {
          data.address = addrVal;
        } else if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (!["प्रमाणित", "दिनांक", "हस्ताक्षर", "तहसीलदार"].some(k => nextLine.includes(k))) {
            data.address = nextLine;
          }
        }
      }
    }
  }

  return {
    document_type: docType,
    fields: data
  };
}
