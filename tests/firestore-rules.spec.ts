import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Firestore Security Rules & Blueprint Integrity", () => {
  const rules = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
  const blueprint = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "firebase-blueprint.json"), "utf8"),
  );

  it("enforces default deny-all fallback and verified-user write checks", () => {
    expect(rules).toContain("match /{document=**} {\n      allow read, write: if false;");
    expect(rules).toContain("request.auth.token.email_verified == true");
    expect(rules).toContain("allow list: if false;");
  });

  it("enforces strict tenant/owner isolation across workspaces and subcollections", () => {
    expect(rules).toContain("existing().ownerId == request.auth.uid");
    expect(rules).toContain(
      "get(/databases/$(database)/documents/workspaces/$(workspaceId)).data.ownerId == request.auth.uid",
    );
  });

  it("rejects demo sourceType and locks terminal published/archived items", () => {
    expect(rules).not.toMatch(/['"]demo['"]/);
    expect(rules).toContain(
      "['live_api', 'live_crawl', 'ai_grounded', 'ai_simulation', 'imported', 'manual']",
    );
    expect(rules).toContain("(!('isDemo' in data) || data.isDemo == false)");
    expect(rules).toContain("!(existing().status in ['archived', 'published'])");
  });

  it("matches firebase-blueprint.json schema without demo enums", () => {
    const sourceEnum =
      blueprint.entities?.WorkspaceItem?.properties?.sourceType?.enum || [];
    expect(sourceEnum).not.toContain("demo");
    const description = String(blueprint.entities?.WorkspaceItem?.description || "");
    for (const term of ["video jobs", "integration connection metadata", "notifications", "audit logs", "AI runs"]) {
      expect(description).toContain(term);
    }
  });
});
