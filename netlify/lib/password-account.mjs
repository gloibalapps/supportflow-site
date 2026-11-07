// Email-and-password licence accounts. The password is hashed with scrypt
// before it is stored. Callers must not log the password or the hash.
import crypto from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

function scrypt(password, salt, keylen, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, params, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export function normaliseAccountEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

export function passwordOk(password) {
  const value = String(password || "");
  return value.length >= 10 && value.length <= 200;
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (n !== N || r !== R || p !== P) return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch { return false; }
  if (salt.length < 8 || expected.length !== KEYLEN) return false;
  const hash = await scrypt(String(password), salt, expected.length, { N: n, r, p });
  return crypto.timingSafeEqual(hash, expected);
}

export function newAccountId() {
  return `acct:${crypto.randomUUID()}`;
}
