import { z } from "zod";

export const DocumentFieldsSchema = z.object({
  documentType: z.string().describe("Type of document: PAN, Aadhaar, Driving License, Voter ID, Passport, Birth Certificate, Bank Statement, Invoice, Other"),
  name: z.string().optional().describe("Full name of the person"),
  dateOfBirth: z.string().optional().describe("Date of birth in DD-MM-YYYY format"),
  fatherName: z.string().optional().describe("Father's or spouse's name"),
  address: z.string().optional().describe("Full address from the document"),
  mobileNumber: z.string().optional().describe("Mobile phone number"),
  email: z.string().optional().describe("Email address"),
  documentNumber: z.string().optional().describe("Document ID number (PAN, Aadhaar, etc.)"),
  gender: z.string().optional().describe("Gender (Male/Female/Other)"),
  additionalFields: z.record(z.string(), z.string()).optional().describe("Any other fields found in the document"),
});

export type DocumentFields = z.infer<typeof DocumentFieldsSchema>;

export const AnalysisResultSchema = z.object({
  rawText: z.string(),
  parsed: DocumentFieldsSchema,
  model: z.string(),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number(),
  }),
  cost: z.number(),
});


