import fs from "fs";
import path from "path";

export interface FirebaseAppletConfig {
  projectId: string;
  appId?: string;
  apiKey?: string;
  authDomain?: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  oAuthClientId?: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;

export function getFirebaseServerConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;

  const candidates = [
    path.resolve(process.cwd(), "firebase-applet-config.json"),
    path.resolve(import.meta.dirname || process.cwd(), "../../firebase-applet-config.json"),
    path.resolve(import.meta.dirname || process.cwd(), "../firebase-applet-config.json"),
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<FirebaseAppletConfig>;
        if (parsed && typeof parsed.projectId === "string" && parsed.projectId.trim()) {
          cachedConfig = {
            projectId: parsed.projectId.trim(),
            appId: parsed.appId,
            apiKey: parsed.apiKey,
            authDomain: parsed.authDomain,
            firestoreDatabaseId: parsed.firestoreDatabaseId,
            storageBucket: parsed.storageBucket,
            messagingSenderId: parsed.messagingSenderId,
            measurementId: parsed.measurementId,
            oAuthClientId: parsed.oAuthClientId,
          };
          return cachedConfig;
        }
      }
    } catch {
      // Try next candidate or env fallback
    }
  }

  const envProjectId =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    "";

  cachedConfig = {
    projectId: envProjectId,
    firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID?.trim() || undefined,
  };
  return cachedConfig;
}

export function isPlaceholderFirebaseProject(): boolean {
  const cfg = getFirebaseServerConfig();
  return !cfg.projectId || cfg.projectId === "remixed-project-id";
}
