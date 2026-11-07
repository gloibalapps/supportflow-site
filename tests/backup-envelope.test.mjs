import test from "node:test";
import assert from "node:assert/strict";
import {
  generateRecoveryKey, normalizeRecoveryKey, createBackupRecord,
  encryptPayloadWithRecord, decryptBackupEnvelope, recoveryKeyMatchesRecord,
} from "../backup-envelope.mjs";

test("recovery key is a grouped code and normalises input", () => {
  const key = generateRecoveryKey();
  assert.match(key, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}(-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}){7}$/);
  assert.equal(normalizeRecoveryKey(`  ${key.toLowerCase()}  `), key.replace(/-/g, ""));
});

test("v2 file opens with the password or the recovery key, and contains neither", async () => {
  const password = "correct horse battery";
  const recovery = generateRecoveryKey();
  const record = await createBackupRecord(password, recovery);
  const file = await encryptPayloadWithRecord(record, JSON.stringify({ hello: "records" }));
  assert.equal(await decryptBackupEnvelope(file, password, "password"), JSON.stringify({ hello: "records" }));
  assert.equal(await decryptBackupEnvelope(file, recovery, "recovery"), JSON.stringify({ hello: "records" }));
  assert.equal(await decryptBackupEnvelope(file, recovery.toLowerCase() + " ", "recovery"), JSON.stringify({ hello: "records" }));
  const env = JSON.parse(file);
  assert.equal(env.envelope, "sf-recovery-v1");
  assert.equal(env.wraps.password.kdf, "PBKDF2-SHA256");
  assert.ok(!file.includes(password));
  assert.ok(!file.includes(recovery));
  assert.ok(!file.includes(record.dataKey));
  assert.equal(JSON.stringify(record).includes(recovery), false);
  await assert.rejects(() => decryptBackupEnvelope(file, "nope-nope-nope", "password"), /wrong-passphrase/);
  await assert.rejects(() => decryptBackupEnvelope(file, "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ", "recovery"), /wrong-passphrase/);
  assert.equal(await recoveryKeyMatchesRecord(record, recovery), true);
  assert.equal(await recoveryKeyMatchesRecord(record, "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ"), false);
});

test("older password-only files still open with that password, not a recovery key", async () => {
  const password = "older-password-value";
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 1000, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt"],
  );
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("plain-v1"));
  const b64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const file = JSON.stringify({
    encrypted: true, kdf: "PBKDF2-SHA256", iterations: 1000,
    salt: b64(salt), iv: b64(iv), data: b64(cipher),
  });
  assert.equal(await decryptBackupEnvelope(file, password, "password"), "plain-v1");
  await assert.rejects(() => decryptBackupEnvelope(file, generateRecoveryKey(), "recovery"), /older-backup/);
});
