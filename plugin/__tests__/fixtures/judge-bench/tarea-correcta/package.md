# Review package: task 3/5 of issue #52 (staged, not yet committed)
Review token: 73ceb59db78cbf5983db6f175f2242346479a076d9d6d9c9b41777ec4b302b13

## Files changed
 src/attempt-budget.js  | 40 ++++++++++++++++++++++++++++++++++++++++
 test/attempt-budget.js | 23 +++++++++++++++++++++++
 2 files changed, 63 insertions(+)


## Rutas tocadas
- src/attempt-budget.js
- test/attempt-budget.js

## Diff
diff --git a/src/attempt-budget.js b/src/attempt-budget.js
new file mode 100644
index 0000000..8b93f2f
--- /dev/null
+++ b/src/attempt-budget.js
@@ -0,0 +1,40 @@
+export const AttemptStep = Object.freeze({
+  RETRY: 'retry',
+  BLOCKED: 'blocked',
+})
+
+export class AttemptBeyondCap extends RangeError {
+  constructor({ attempt, cap }) {
+    super(`attempt ${attempt} is beyond the cap of ${cap}`)
+    this.attempt = attempt
+    this.cap = cap
+  }
+}
+
+export class AttemptEffect {
+  constructor({ step, attempt }) {
+    this.step = step
+    this.attempt = attempt
+    Object.freeze(this)
+  }
+}
+
+export class AttemptBudget {
+  constructor({ cap }) {
+    if (!Number.isInteger(cap) || cap < 1) {
+      throw new RangeError(`cap must be a positive integer, got ${JSON.stringify(cap)}`)
+    }
+    this.cap = cap
+    Object.freeze(this)
+  }
+
+  next(attempt) {
+    if (!Number.isInteger(attempt) || attempt < 1) {
+      throw new RangeError(`attempt must be a positive integer, got ${JSON.stringify(attempt)}`)
+    }
+    if (attempt > this.cap) throw new AttemptBeyondCap({ attempt, cap: this.cap })
+    return attempt < this.cap
+      ? new AttemptEffect({ step: AttemptStep.RETRY, attempt: attempt + 1 })
+      : new AttemptEffect({ step: AttemptStep.BLOCKED, attempt })
+  }
+}
diff --git a/test/attempt-budget.js b/test/attempt-budget.js
new file mode 100644
index 0000000..0340d5a
--- /dev/null
+++ b/test/attempt-budget.js
@@ -0,0 +1,23 @@
+import { describe, it } from 'node:test'
+import assert from 'node:assert/strict'
+import { AttemptBeyondCap, AttemptBudget, AttemptEffect, AttemptStep } from '../src/attempt-budget.js'
+
+class Budgets {
+  static ofThreeAttempts() {
+    return new AttemptBudget({ cap: 3 })
+  }
+}
+
+describe('AttemptBudget', () => {
+  it('an attempt under the cap retries with the next number', () => {
+    assert.deepEqual(Budgets.ofThreeAttempts().next(1), new AttemptEffect({ step: AttemptStep.RETRY, attempt: 2 }))
+  })
+
+  it('the attempt at the cap is blocked instead of retried', () => {
+    assert.deepEqual(Budgets.ofThreeAttempts().next(3), new AttemptEffect({ step: AttemptStep.BLOCKED, attempt: 3 }))
+  })
+
+  it('an attempt beyond the cap is an error, not a silent block', () => {
+    assert.throws(() => Budgets.ofThreeAttempts().next(4), AttemptBeyondCap)
+  })
+})
