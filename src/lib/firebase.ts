import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  getRedirectResult,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, getDocFromServer, getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import firebaseConfig from "../../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app, `gs://${firebaseConfig.storageBucket}`);

export const WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/forms.responses.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
];

let cachedWorkspaceToken: string | null = null;

export function getCachedWorkspaceToken(): string | null {
  return cachedWorkspaceToken;
}

export function clearCachedWorkspaceToken(): void {
  cachedWorkspaceToken = null;
}

export function formatFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || "";
  const msg = err instanceof Error ? err.message : String(err);
  if (code === "auth/unauthorized-domain") {
    const host = typeof window !== "undefined" ? window.location.hostname : "this domain";
    return `Domain "${host}" is not authorized for Firebase Authentication. Add "${host}" in Firebase Console > Authentication > Settings > Authorized domains.`;
  }
  if (code === "auth/popup-blocked") {
    return "Sign-in popup was blocked by your browser. Allow popups or tap Continue with Google again to use redirect sign-in.";
  }
  if (code === "auth/cancelled-popup-request") {
    return "Previous sign-in popup was superseded. Please try signing in again.";
  }
  if (code === "auth/network-request-failed") {
    return "Network error contacting Firebase Authentication. Check your connection and try again.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Email/Password sign-in is not yet enabled in Firebase Authentication Console (Authentication > Sign-in method). You can use Google Sign-In immediately or enable Email/Password in Firebase Console.";
  }
  if (code === "auth/email-already-in-use") {
    return "An account with this email already exists. Try signing in instead.";
  }
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Incorrect email or password. Double-check your credentials or reset your password.";
  }
  if (code === "auth/weak-password") {
    return "Password must be at least 6 characters long.";
  }
  if (code === "auth/requires-recent-login") {
    return "For security, please sign out and sign back in right before deleting your account.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Wait a brief moment before trying again.";
  }
  if (code === "auth/popup-closed-by-user") {
    return "Google sign-in popup was closed before finishing.";
  }
  return msg || "Authentication request failed.";
}

export function isGoogleSignedInUser(user: User | null): boolean {
  if (!user) return false;
  return Boolean(user.providerData?.some((p) => p.providerId === "google.com"));
}

export async function consumeGoogleRedirectResult(): Promise<{
  user: User | null;
  workspaceToken: string | null;
}> {
  const result = await getRedirectResult(auth);
  if (!result) return { user: null, workspaceToken: cachedWorkspaceToken };
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    cachedWorkspaceToken = credential.accessToken;
  }
  return {
    user: result.user,
    workspaceToken: cachedWorkspaceToken,
  };
}

export async function signInWithGoogle(includeWorkspaceScopes = false): Promise<{
  user: User | null;
  workspaceToken: string | null;
  redirected?: boolean;
}> {
  const provider = new GoogleAuthProvider();
  provider.addScope("email");
  provider.addScope("profile");
  if (includeWorkspaceScopes) {
    for (const scope of WORKSPACE_SCOPES) {
      provider.addScope(scope);
    }
    provider.setCustomParameters({ prompt: "consent", access_type: "online" });
  } else {
    provider.setCustomParameters({ prompt: "select_account" });
  }

  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedWorkspaceToken = credential.accessToken;
    }
    return {
      user: result.user,
      workspaceToken: cachedWorkspaceToken,
    };
  } catch (err) {
    const code = (err as { code?: string })?.code || "";
    const isTopLevelWindow = typeof window !== "undefined" && window.self === window.top;
    if (
      isTopLevelWindow &&
      (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment")
    ) {
      await signInWithRedirect(auth, provider);
      return { user: null, workspaceToken: null, redirected: true };
    }
    throw err;
  }
}

export async function registerWithEmailPassword(params: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, params.email.trim(), params.password);
  if (params.displayName?.trim()) {
    await updateProfile(cred.user, { displayName: params.displayName.trim() });
  }
  await sendEmailVerification(cred.user).catch(() => {
    // non-fatal; user can resend verification
  });
  return cred.user;
}

export async function signInWithEmailPassword(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function sendVerificationEmail(): Promise<void> {
  if (!auth.currentUser) throw new Error("Sign in first to verify your email.");
  await sendEmailVerification(auth.currentUser);
}

export async function reloadCurrentUser(): Promise<User | null> {
  if (!auth.currentUser) return null;
  await reload(auth.currentUser);
  return auth.currentUser;
}

export async function resetPasswordEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function updateUserProfileInfo(displayName: string): Promise<void> {
  if (!auth.currentUser) throw new Error("Sign in required.");
  await updateProfile(auth.currentUser, { displayName: displayName.trim() });
}

export async function deleteCurrentUserAccount(): Promise<void> {
  if (!auth.currentUser) throw new Error("Sign in required.");
  await deleteUser(auth.currentUser);
  cachedWorkspaceToken = null;
}

export async function signOutGoogle(): Promise<void> {
  cachedWorkspaceToken = null;
  await signOut(auth);
}

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration (Firestore offline).");
    }
    return false;
  }
}
