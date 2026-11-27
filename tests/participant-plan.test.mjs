// Run: node --test tests/participant-plan.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyParticipantSave,
  filterPlanManagers,
  participantPlanBlock,
  PLAN_MANAGER_SEARCH_AT,
} from "../participant-plan.js";

const seq = (ids) => {
  let n = 0;
  return () => ids[n++];
};

test("plan-managed save is blocked without a plan manager", () => {
  const data = { managers: [], participants: [{ id: "keep", name: "Already here" }] };
  const created = applyParticipantSave(data, { name: "Alex", planType: "plan", managerId: "" }, null, { idFactory: () => "p1" });
  assert.equal(created.ok, false);
  assert.match(created.error, /plan manager/i);
  assert.equal(created.data, data);
  assert.equal(data.participants.length, 1);

  const dangling = applyParticipantSave(
    { managers: [{ id: "m1", name: "Saved", email: "a@b.co", terms: "14" }], participants: [] },
    { name: "Alex", planType: "plan", managerId: "missing" },
    null,
    { idFactory: () => "p1" },
  );
  assert.equal(dangling.ok, false);
  assert.equal(dangling.data.participants.length, 0);

  const existing = { managers: [], participants: [{ id: "p9", name: "Casey", planType: "plan", managerId: "", email: "c@x.co" }] };
  const edited = applyParticipantSave(existing, { ...existing.participants[0], phone: "0400000000" }, null, { idFactory: () => "nope" });
  assert.equal(edited.ok, false);
  assert.equal(edited.data, existing);
  assert.equal(existing.participants[0].phone, undefined);
});

test("picking an existing plan manager links and does not create another", () => {
  const managers = [
    { id: "m1", name: "Plan Partners", email: "accounts@plan.test", terms: "14" },
    { id: "m2", name: "My Plan Manager", email: "invoices@myplan.test", terms: "21" },
  ];
  const data = { managers, participants: [] };
  const found = filterPlanManagers(managers, "partners");
  assert.deepEqual(found.map((m) => m.id), ["m1"]);
  assert.equal(filterPlanManagers(managers, "").length, 2);
  assert.equal(PLAN_MANAGER_SEARCH_AT > 1, true);

  const saved = applyParticipantSave(
    data,
    { name: "Alex", planType: "plan", managerId: found[0].id, email: "alex@example.com" },
    null,
    { idFactory: () => "p1" },
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.error, "");
  assert.equal(saved.participant.id, "p1");
  assert.equal(saved.participant.managerId, "m1");
  assert.equal(saved.data.managers.length, 2);
  assert.equal(saved.data.participants.length, 1);
  assert.equal(participantPlanBlock(saved.participant, saved.data.managers, null), "");
});

test("a new plan manager is created and linked in the same save", () => {
  const data = { managers: [{ id: "old", name: "Old Co", email: "old@co.test", terms: "7" }], participants: [] };
  const blocked = applyParticipantSave(
    data,
    { name: "Alex", planType: "plan" },
    { name: "  ", email: "not-an-email", terms: "" },
    { idFactory: seq(["should-not", "happen"]) },
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.data, data);
  assert.equal(data.managers.length, 1);

  const saved = applyParticipantSave(
    data,
    { name: "Alex", planType: "plan", email: "alex@example.com" },
    { name: "Acme Plan Management", email: "Invoices@Acme.test", terms: "14", address: "1 King St", contact: "Sam" },
    { idFactory: seq(["mgr-new", "p-new"]) },
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.createdManager.id, "mgr-new");
  assert.equal(saved.createdManager.email, "invoices@acme.test");
  assert.equal(saved.createdManager.terms, "14");
  assert.equal(saved.createdManager.address, "1 King St");
  assert.equal(saved.participant.id, "p-new");
  assert.equal(saved.participant.managerId, "mgr-new");
  assert.equal(saved.data.managers.length, 2);
  assert.equal(saved.data.managers[0].id, "old");
  assert.equal(data.managers.length, 1);
});

test("self-managed and NDIA-managed save without a plan manager", () => {
  const managers = [{ id: "m1", name: "Plan Partners", email: "a@b.co", terms: "14" }];
  for (const planType of ["self", "agency"]) {
    const saved = applyParticipantSave(
      { managers, participants: [] },
      { name: planType === "self" ? "Riley" : "Jordan", planType, managerId: "m1", email: "person@example.com", terms: "7" },
      { name: "Should not be created", email: "nope@example.com", terms: "14" },
      { idFactory: () => planType + "-id" },
    );
    assert.equal(saved.ok, true, planType);
    assert.equal(saved.participant.managerId, "");
    assert.equal(saved.participant.planType, planType);
    assert.equal(saved.createdManager, null);
    assert.equal(saved.data.managers.length, 1);
  }

  const selfNeedsEmail = applyParticipantSave(
    { managers: [], participants: [] },
    { name: "Riley", planType: "self", terms: "7" },
    null,
    { idFactory: () => "p-self" },
  );
  assert.equal(selfNeedsEmail.ok, false);
  assert.match(selfNeedsEmail.error, /billing email/i);

  const agencyWithoutEmail = applyParticipantSave(
    { managers: [], participants: [] },
    { name: "Jordan", planType: "agency", terms: "14" },
    null,
    { idFactory: () => "p-agency" },
  );
  assert.equal(agencyWithoutEmail.ok, true);
  assert.equal(agencyWithoutEmail.participant.managerId, "");

  const existingSelf = applyParticipantSave(
    { managers: [], participants: [] },
    { id: "old-self", name: "Riley", planType: "self", email: "", terms: "7" },
    null,
    { idFactory: () => "unused" },
  );
  assert.equal(existingSelf.ok, true);
  assert.equal(existingSelf.participant.email, "");
});

test("the add-participant screens call the save check", () => {
  const jsx = readFileSync(new URL("../app.jsx", import.meta.url), "utf8");
  const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
  for (const src of [jsx, html]) {
    assert.match(src, /Is their plan manager already saved in SupportFlow\?/);
    assert.match(src, /function applyParticipantSave/);
    const calls = src.split("applyParticipantSave(").length - 1;
    assert.ok(calls >= 2, "setup and the participant directory both save through applyParticipantSave");
  }
});
