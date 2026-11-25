import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load `.env`, then `.env.local`. Neither overrides variables already set by the host (CI, Vercel, tests).
const envKeysBeforeFiles = new Set(Object.keys(process.env));
for (const envFile of [".env", ".env.local"]) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(envPath)) continue;
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  for (const [key, value] of Object.entries(parsed)) {
    if (!envKeysBeforeFiles.has(key)) process.env[key] = value;
  }
}
