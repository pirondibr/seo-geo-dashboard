import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE = "geo_agency";

function secret() {
  return process.env.AUTH_SECRET || process.env.AGENCY_PASSWORD || "dev-secret-change-me";
}

export function expectedPassword() {
  return process.env.AGENCY_PASSWORD || "agencia";
}

export function signSession(payload: string) {
  const body = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined) {
  if (!token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function isLoggedIn() {
  const jar = await cookies();
  return verifySession(jar.get(COOKIE)?.value);
}

export function sessionCookieName() {
  return COOKIE;
}
