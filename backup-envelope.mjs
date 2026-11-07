// Backup envelope. Inlined into app.jsx by build-app.mjs (export keywords stripped).
// Also imported by tests. Uses Web Crypto only.
//
// A backup file is encrypted with a random data key. That key is wrapped twice:
// once for the backup password and once for a recovery key. The readable
// password and the readable recovery key are never written into the file.
// Older files (no `wraps`) still open with the password they were made with.

const BACKUP_KDF_ITERATIONS = 250000;
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function backupB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function backupB64d(s) {
  const bin = atob(String(s || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function generateRecoveryKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = 0, nbits = 0;
  const chars = [];
  for (const b of bytes) {
    bits = (bits << 8) | b;
    nbits += 8;
    while (nbits >= 5 && chars.length < 32) {
      nbits -= 5;
      chars.push(RECOVERY_ALPHABET[(bits >> nbits) & 31]);
    }
  }
  return chars.join("").match(/.{4}/g).join("-");
}

function normalizeRecoveryKey(value) {
  return String(value || "").toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, "");
}

async function deriveWrapKey(secret, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function wrapDataKey(dataKey, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveWrapKey(secret, salt, BACKUP_KDF_ITERATIONS);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dataKey);
  return {
    kdf: "PBKDF2-SHA256",
    iterations: BACKUP_KDF_ITERATIONS,
    salt: backupB64(salt),
    iv: backupB64(iv),
    data: backupB64(cipher),
  };
}

async function unwrapDataKey(wrap, secret) {
  const key = await deriveWrapKey(normalizeSecretForWrap(secret, wrap), backupB64d(wrap.salt), wrap.iterations || BACKUP_KDF_ITERATIONS);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: backupB64d(wrap.iv) }, key, backupB64d(wrap.data));
  return new Uint8Array(plain);
}

function normalizeSecretForWrap(secret, wrap) {
  // Recovery keys are grouped codes. Passwords are kept exactly as typed.
  // Callers pass kind separately; this only normalises when the secret looks
  // like a recovery code (no lowercase letters and mostly the recovery alphabet).
  return String(secret);
}

async function createBackupRecord(passphrase, recoveryKey) {
  const dataKey = crypto.getRandomValues(new Uint8Array(32));
  const passwordWrap = await wrapDataKey(dataKey, passphrase);
  const recoveryWrap = await wrapDataKey(dataKey, normalizeRecoveryKey(recoveryKey));
  return {
    v: 2,
    dataKey: backupB64(dataKey),
    passwordWrap,
    recoveryWrap,
  };
}

async function encryptPayloadWithRecord(record, text) {
  if (!record || record.v !== 2 || !record.dataKey || !record.passwordWrap || !record.recoveryWrap) {
    throw new Error("backup-record-missing");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", backupB64d(record.dataKey), { name: "AES-GCM" }, false, ["encrypt"]);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return JSON.stringify({
    encrypted: true,
    envelope: "sf-recovery-v1",
    iv: backupB64(iv),
    data: backupB64(cipher),
    wraps: { password: record.passwordWrap, recovery: record.recoveryWrap },
  });
}

async function decryptBackupEnvelope(json, secret, kind) {
  const env = JSON.parse(json);
  if (!env || !env.encrypted) return json;
  const mode = kind === "recovery" ? "recovery" : "password";
  if (env.wraps && env.wraps.password && env.wraps.recovery) {
    const wrap = env.wraps[mode];
    if (!wrap) throw new Error("wrong-passphrase");
    const secretBytes = mode === "recovery" ? normalizeRecoveryKey(secret) : String(secret);
    if (mode === "recovery" && secretBytes.length < 20) throw new Error("wrong-passphrase");
    let dataKey;
    try { dataKey = await unwrapDataKey(wrap, secretBytes); }
    catch (e) { throw new Error("wrong-passphrase"); }
    try {
      const key = await crypto.subtle.importKey("raw", dataKey, { name: "AES-GCM" }, false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: backupB64d(env.iv) }, key, backupB64d(env.data));
      return new TextDecoder().decode(plain);
    } catch (e) {
      throw new Error("wrong-passphrase");
    }
  }
  if (mode === "recovery") throw new Error("older-backup");
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: backupB64d(env.salt), iterations: env.iterations || BACKUP_KDF_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: backupB64d(env.iv) }, key, backupB64d(env.data));
    return new TextDecoder().decode(plain);
  } catch (e) {
    throw new Error("wrong-passphrase");
  }
}

async function recoveryKeyMatchesRecord(record, recoveryKey) {
  if (!record || record.v !== 2 || !record.recoveryWrap || !record.dataKey) return false;
  try {
    const got = await unwrapDataKey(record.recoveryWrap, normalizeRecoveryKey(recoveryKey));
    const expect = backupB64d(record.dataKey);
    if (got.length !== expect.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got[i] ^ expect[i];
    return diff === 0;
  } catch (e) {
    return false;
  }
}

export {
  generateRecoveryKey,
  normalizeRecoveryKey,
  createBackupRecord,
  encryptPayloadWithRecord,
  decryptBackupEnvelope,
  recoveryKeyMatchesRecord,
  BACKUP_KDF_ITERATIONS,
};
