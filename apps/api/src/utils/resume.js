import { OpenAI } from "openai";
import { resumeProfileSchema } from "@pondbridge/shared";
import { env } from "../config/env.js";

const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

function tryParseJson(content = "") {
  const trimmed = content.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "");
  return JSON.parse(trimmed);
}

function heuristicParse(text = "") {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)?.[0] || "";
  const phone =
    text.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] || "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const nameLine = lines[0] || "";
  const [firstName = "", ...rest] = nameLine.split(" ");
  const lastName = rest.join(" ");

  return {
    firstName,
    lastName,
    email,
    phone,
    cityState: "",
    highSchool: "",
    colleges: [],
    collegeYears: [],
    currentJobs: [],
    pastJobs: [],
    industry: "",
    socials: { linkedin: "", instagram: "", facebook: "" }
  };
}

export async function parseResumeTextToProfile(resumeText = "") {
  if (!resumeText.trim()) {
    throw new Error("Resume text is empty");
  }

  let parsed;

  if (openai) {
    const prompt = `Extract profile data from this resume as strict JSON.

Schema:
{
  "firstName": "",
  "lastName": "",
  "email": "",
  "phone": "",
  "cityState": "",
  "highSchool": "",
  "colleges": [""],
  "collegeYears": [""],
  "currentJobs": [{"role": "", "company": "", "years": ""}],
  "pastJobs": [{"role": "", "company": "", "years": ""}],
  "industry": "",
  "socials": {"linkedin": "", "instagram": "", "facebook": ""}
}

Resume:\n${resumeText.slice(0, 120000)}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }]
    });

    parsed = tryParseJson(response.choices?.[0]?.message?.content || "{}");
  } else {
    parsed = heuristicParse(resumeText);
  }

  const result = resumeProfileSchema.safeParse(parsed);
  if (!result.success) {
    const validationError = new Error("Resume parser returned invalid schema");
    validationError.code = "RESUME_SCHEMA_INVALID";
    validationError.statusCode = 400;
    validationError.details = result.error.flatten();
    throw validationError;
  }

  return result.data;
}
