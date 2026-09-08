import { parse as parseCsv } from "csv-parse/sync";

/**
 * One parse, one set of options. The analyze, dry-run and commit steps all read
 * the same file, and a header the mapper saw one way and the importer another
 * would silently drop a column.
 */
export function parseImportCsv(csvBuffer) {
  const csvText = Buffer.isBuffer(csvBuffer) ? csvBuffer.toString("utf8") : String(csvBuffer || "");
  try {
    return parseCsv(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true
    });
  } catch (error) {
    const csvError = new Error(error.message || "Invalid CSV format");
    csvError.code = "CSV_INVALID_FORMAT";
    throw csvError;
  }
}
