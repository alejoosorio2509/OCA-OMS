import assert from "node:assert/strict";
import test from "node:test";
import { canTransition } from "./workOrderStateMachine.js";

test("canTransition permite el flujo principal", () => {
  assert.equal(canTransition("CREATED", "ASSIGNED"), true);
  assert.equal(canTransition("ASSIGNED", "IN_PROGRESS"), true);
  assert.equal(canTransition("IN_PROGRESS", "COMPLETED"), true);
});

test("canTransition bloquea transiciones inválidas", () => {
  assert.equal(canTransition("CREATED", "COMPLETED"), false);
  assert.equal(canTransition("COMPLETED", "IN_PROGRESS"), false);
  assert.equal(canTransition("CANCELLED", "CREATED"), false);
});

