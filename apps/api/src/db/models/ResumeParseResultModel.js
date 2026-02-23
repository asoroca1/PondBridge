import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  createdByUserId: "created_by_user_id",
  fileHash: "file_hash",
  fileName: "file_name",
  mimeType: "mime_type",
  fileSizeBytes: "file_size_bytes",
  promptVersion: "prompt_version",
  parserEngine: "parser_engine",
  parserModel: "parser_model",
  extractionStrategy: "extraction_strategy",
  extractedText: "extracted_text",
  extractedTextLength: "extracted_text_length",
  parsedProfile: "parsed_profile",
  cacheHits: "cache_hits",
  reparseCount: "reparse_count",
  lastParsedAt: "last_parsed_at",
  lastUsedAt: "last_used_at",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const ResumeParseResultModel = createModel("resume_parse_results", COLUMNS);
