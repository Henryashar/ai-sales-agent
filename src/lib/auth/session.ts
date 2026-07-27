import { createHash, createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "ai_sales_agent_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type AuthUser = {
  name: string;
  email: string;
};

export type AuthSession = {
  user: AuthUser;
  issuedAt: number;
  expiresAt: number;
};

type ConfiguredUser = AuthUser & {
  code?: string;
  codeHash?: string;
};

type SignInInput = {
  name?: string;
  email: string;
  code: string;
};

export function authenticateUser(input: SignInInput): AuthUser | undefined {
  const email = normalizeEmail(input.email);
  const code = input.code.trim();

  if (!email || !code) {
    return undefined;
  }

  const configuredUsers = getConfiguredUsers();
  if (configuredUsers.length) {
    const user = configuredUsers.find((candidate) => normalizeEmail(candidate.email) === email);

    if (!user || !isValidUserCode(code, user)) {
      return undefined;
    }

    return { name: user.name, email: user.email };
  }

  const sharedToken = process.env.APP_ACCESS_TOKEN?.trim();
  const name = input.name?.trim();

  if (sharedToken && name && timingSafeEqualString(code, sharedToken)) {
    return { name, email };
  }

  return undefined;
}

export function createSessionCookie(user: AuthUser, now = Date.now()) {
  const session: AuthSession = {
    user,
    issuedAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
  };
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");

  return `${payload}.${sign(payload)}`;
}

export function readSessionCookie(value: string | undefined, now = Date.now()): AuthSession | undefined {
  if (!value) {
    return undefined;
  }

  const [payload, signature, extra] = value.split(".");

  if (!payload || !signature || extra || !timingSafeEqualString(signature, sign(payload))) {
    return undefined;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthSession;

    if (!isAuthSession(session) || session.expiresAt <= now) {
      return undefined;
    }

    return session;
  } catch {
    return undefined;
  }
}

export function getSessionFromRequest(request: Request) {
  return readSessionCookie(readCookieHeader(request.headers.get("cookie"))[SESSION_COOKIE_NAME]);
}

export function formatActor(actor: AuthUser) {
  return `${actor.name} (${actor.email})`;
}

export function authIsConfigured() {
  return Boolean(process.env.AUTH_SESSION_SECRET?.trim() || process.env.APP_ACCESS_TOKEN?.trim());
}

function getConfiguredUsers() {
  const rawUsers = process.env.APP_USERS_JSON?.trim();

  if (!rawUsers) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawUsers) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isConfiguredUser);
  } catch {
    return [];
  }
}

function isConfiguredUser(value: unknown): value is ConfiguredUser {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === "string" &&
    typeof value.email === "string" &&
    (typeof value.code === "string" || typeof value.codeHash === "string")
  );
}

function isValidUserCode(code: string, user: ConfiguredUser) {
  if (user.codeHash) {
    return timingSafeEqualString(hashCode(code), user.codeHash.trim().toLowerCase());
  }

  return Boolean(user.code && timingSafeEqualString(code, user.code));
}

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function sign(payload: string) {
  const secret = process.env.AUTH_SESSION_SECRET?.trim() || process.env.APP_ACCESS_TOKEN?.trim();

  if (!secret) {
    throw new Error("Missing AUTH_SESSION_SECRET or APP_ACCESS_TOKEN.");
  }

  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function timingSafeEqualString(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();

  return timingSafeEqual(leftDigest, rightDigest);
}

function readCookieHeader(header: string | null) {
  const cookies: Record<string, string> = {};

  for (const cookie of header?.split(";") ?? []) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();
    const value = cookie.slice(separatorIndex + 1).trim();

    if (name) {
      cookies[name] = decodeURIComponent(value);
    }
  }

  return cookies;
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!isRecord(value) || !isRecord(value.user)) {
    return false;
  }

  return (
    typeof value.user.name === "string" &&
    typeof value.user.email === "string" &&
    typeof value.issuedAt === "number" &&
    typeof value.expiresAt === "number"
  );
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();

  return email.includes("@") ? email : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
