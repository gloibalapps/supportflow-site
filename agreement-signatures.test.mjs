// Run: node --test agreement-signatures.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGREEMENT_ROLES, agreementRoleLabel, defaultAgreementParties, resolveAgreementParties,
  commitStroke, clearParty, redoParty, dropLastStroke, addParty, removeParty, blankParty,
  suggestedPartyName, partiesForSave, patchParty, requiredPartiesSigned, agreementStatusFromParties,
} from "./agreement-signatures.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const STROKE = [[0.15, 0.7], [0.4, 0.3], [0.72, 0.62]];

test("defaults are the participant and the sole trader, and are not treated as saved", () => {
  const parties = resolveAgreementParties({ name: "Alex Johnson" }, { name: "Sam Taylor" });
  assert.deepEqual(parties.map((p) => p.role), ["participant", "worker"]);
  assert.equal(parties[0].name, "Alex Johnson");
  assert.equal(parties[1].name, "Sam Taylor");
  assert.equal(parties.every((p) => !p.signature), true);
  assert.equal(AGREEMENT_ROLES.some((r) => r.id === "nominee"), true);
  assert.equal(agreementRoleLabel(parties[1]), "Sole trader (support worker)");
});

test("a saved empty list stays empty", () => {
  assert.deepEqual(resolveAgreementParties({ agreementParties: [] }, { name: "Sam Taylor" }), []);
});

test("three roles sign, clear, redo, and survive a JSON reload", () => {
  let parties = defaultAgreementParties({ name: "Riley Williams" }, { name: "Sam Taylor" });
  parties = addParty(parties, blankParty({ id: "party-witness", role: "witness", name: "Jane Lee" }));
  assert.deepEqual(parties.map((p) => p.role), ["participant", "worker", "witness"]);
  parties = parties.map((p) => commitStroke(p, STROKE, PNG, "2026-11-27"));
  const stored = JSON.parse(JSON.stringify(parties));
  const loaded = resolveAgreementParties({ name: "Riley Williams", agreementParties: stored }, { name: "Sam Taylor" });
  assert.equal(loaded.length, 3);
  assert.deepEqual(loaded.map((p) => [p.role, p.name, p.signedAt]), [
    ["participant", "Riley Williams", "2026-11-27"],
    ["worker", "Sam Taylor", "2026-11-27"],
    ["witness", "Jane Lee", "2026-11-27"],
  ]);
  assert.equal(loaded.every((p) => p.signature === PNG && p.strokes.length === 1 && p.strokes[0].length === 3), true);

  const cleared = clearParty(loaded[2]);
  assert.equal(cleared.signature, "");
  assert.equal(cleared.strokes.length, 0);
  assert.equal(cleared.signedAt, "");
  assert.equal(cleared.name, "Jane Lee");
  const restored = redoParty(cleared);
  assert.equal(restored.signature, PNG);
  assert.equal(restored.signedAt, "2026-11-27");
  assert.equal(restored.strokes.length, 1);
  assert.equal(restored.redo, null);

  const undone = dropLastStroke(restored);
  assert.equal(undone.changed, true);
  assert.equal(undone.party.strokes.length, 0);
  assert.ok(undone.party.redo);
  assert.equal(redoParty(undone.party).strokes.length, 1);
});

test("other role keeps its own title, and names are suggested for known roles", () => {
  const other = patchParty(blankParty({ id: "x", role: "other", name: "Pat" }), { customRole: "Advocate" });
  assert.equal(agreementRoleLabel(other), "Advocate");
  const managers = [{ id: "m1", name: "Plan Partners Australia" }];
  assert.equal(suggestedPartyName("planManager", { managerId: "m1" }, {}, managers), "Plan Partners Australia");
  assert.equal(suggestedPartyName("worker", {}, { name: "Sam Taylor" }, []), "Sam Taylor");
  assert.equal(suggestedPartyName("witness", { name: "Alex" }, { name: "Sam" }, []), "");
});

test("removing a party and saving the rest does not bring the defaults back", () => {
  const parties = removeParty(defaultAgreementParties({ name: "Alex" }, { name: "Sam" }), "party-worker");
  const saved = partiesForSave(parties);
  assert.deepEqual(saved.map((p) => p.role), ["participant"]);
  assert.deepEqual(resolveAgreementParties({ agreementParties: saved }, {}).map((p) => p.role), ["participant"]);
});

test("a non-image signature is dropped rather than stored", () => {
  const party = commitStroke(blankParty({ id: "p", role: "participant", name: "Alex" }), STROKE, "not-a-png", "2026-11-27");
  assert.equal(party.signature, "");
  assert.equal(party.strokes.length, 1);
  assert.equal(party.signedAt, "2026-11-27");
});

function signed(role, name) {
  return commitStroke(blankParty({ id: role, role, name }), STROKE, PNG, "2026-11-27");
}

test("the agreement is signed only when the participant and the sole trader have both signed", () => {
  const witnessOnly = [signed("witness", "Jane Lee")];
  const participantOnly = [signed("participant", "Riley Williams"), blankParty({ id: "party-worker", role: "worker", name: "Sam Taylor" })];
  const workerOnly = [blankParty({ id: "party-participant", role: "participant", name: "Riley" }), signed("worker", "Sam Taylor"), signed("coordinator", "Casey Nguyen")];
  const both = [signed("participant", "Riley Williams"), signed("worker", "Sam Taylor"), signed("witness", "Jane Lee")];
  const representative = [signed("representative", "Pat Rees"), signed("worker", "Sam Taylor")];

  assert.equal(requiredPartiesSigned(witnessOnly), false);
  assert.equal(requiredPartiesSigned(participantOnly), false);
  assert.equal(requiredPartiesSigned(workerOnly), false);
  assert.equal(requiredPartiesSigned(both), true);
  assert.equal(requiredPartiesSigned(representative), true);

  assert.equal(agreementStatusFromParties({ agreement: false }, witnessOnly, "2026-11-27").agreement, false);
  assert.equal(agreementStatusFromParties({ agreement: false }, participantOnly, "2026-11-27").agreement, false);
  assert.equal(agreementStatusFromParties({ agreement: false }, workerOnly, "2026-11-27").agreement, false);

  const complete = agreementStatusFromParties({ agreement: false }, both, "2026-11-27");
  assert.equal(complete.agreement, true);
  assert.equal(complete.agreementDate, "2026-11-27");
  assert.equal(complete.agreementSignedSource, "parties");

  const cleared = agreementStatusFromParties(complete, [both[0], clearParty(both[1]), both[2]], "2026-11-27");
  assert.equal(cleared.agreement, false);
  assert.equal(cleared.agreementDate, "");
  assert.equal(cleared.agreementSignedSource, "");

  const explicit = agreementStatusFromParties({ agreement: true, agreementDate: "2026-01-02", agreementSignedSource: "explicit" }, witnessOnly, "2026-11-27");
  assert.equal(explicit.agreement, true);
  assert.equal(explicit.agreementDate, "2026-01-02");
  assert.equal(explicit.agreementSignedSource, "explicit");
});
