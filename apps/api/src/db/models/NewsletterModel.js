import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  title: "title",
  season: "season",
  year: "year",
  pdfName: "pdf_name",
  pdfMimeType: "pdf_mime_type",
  pdfData: "pdf_data",
  coverImageName: "cover_image_name",
  coverImageMimeType: "cover_image_mime_type",
  coverImageData: "cover_image_data",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const NewsletterModel = createModel("newsletters", COLUMNS);
