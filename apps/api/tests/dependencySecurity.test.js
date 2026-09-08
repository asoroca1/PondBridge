import express from "express";
import multer from "multer";
import request from "supertest";
import nodemailer from "nodemailer";

test("multipart array indices cannot stall or crash a memory upload parser", async () => {
  const app = express();
  app.post("/upload", multer({ storage: multer.memoryStorage(), limits: { fieldArrayIndexLimit: 100 } }).single("file"),
    (req, res) => res.json({ bytes: req.file?.size || 0 }));
  app.use((error, _req, res, _next) => res.status(400).json({ error: error.code || "INVALID_MULTIPART" }));
  const malicious = await request(app).post("/upload").field("items[4294967294]", "x").field("items[key]", "y");
  expect(malicious.status).toBe(400);
  const normal = await request(app).post("/upload").attach("file", Buffer.from("safe,csv\n1,2"), "fixture.csv");
  expect(normal.status).toBe(200);
  expect(normal.body.bytes).toBe(12);
});

test("SMTP MIME composition preserves explicit recipients and rejects remote attachment resolution", async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, disableFileAccess: true, disableUrlAccess: true });
  const result = await transport.sendMail({ from: "sender@synthetic.invalid", to: "member@synthetic.invalid",
    subject: "Synthetic approval", text: "Your director approved your request." });
  expect(result.envelope.to).toEqual(["member@synthetic.invalid"]);
  expect(result.message.toString()).toContain("Synthetic approval");
  await expect(transport.sendMail({ from: "sender@synthetic.invalid", to: "member@synthetic.invalid", text: "Synthetic",
    attachments: [{ filename: "blocked.txt", path: "https://synthetic.invalid/no-network" }] })).rejects.toThrow(/Url access rejected/i);
});
