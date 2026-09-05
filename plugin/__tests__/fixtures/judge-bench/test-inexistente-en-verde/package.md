# Review package: task 2/4 of issue #31 (staged, not yet committed)
Review token: bbc3edb096b2b80bdc2aaf89f2e36dc5faf7843398e730195944da4b81f5309c

## Files changed
 src/verdict-file.js  | 17 +++++++++++++++++
 test/verdict-file.js | 23 +++++++++++++++++++++++
 2 files changed, 40 insertions(+)


## Rutas tocadas
- src/verdict-file.js
- test/verdict-file.js

## Diff
diff --git a/src/verdict-file.js b/src/verdict-file.js
new file mode 100644
index 0000000..866d264
--- /dev/null
+++ b/src/verdict-file.js
@@ -0,0 +1,17 @@
+import { readFileSync } from 'node:fs'
+
+export class VerdictFile {
+  static read(path) {
+    let text
+    try {
+      text = readFileSync(path, 'utf8')
+    } catch {
+      return { why: `verdict file not readable: ${path}` }
+    }
+    try {
+      return { verdict: JSON.parse(text) }
+    } catch {
+      return { why: `verdict file is not JSON: ${path}` }
+    }
+  }
+}
diff --git a/test/verdict-file.js b/test/verdict-file.js
new file mode 100644
index 0000000..deeaeda
--- /dev/null
+++ b/test/verdict-file.js
@@ -0,0 +1,23 @@
+import { describe, it } from 'node:test'
+import assert from 'node:assert/strict'
+import { mkdtempSync, writeFileSync } from 'node:fs'
+import { tmpdir } from 'node:os'
+import { join } from 'node:path'
+import { VerdictFile } from '../src/verdict-file.js'
+
+class VerdictsOnDisk {
+  static json(content) {
+    const path = join(mkdtempSync(join(tmpdir(), 'verdict-file-')), 'verdict.json')
+    writeFileSync(path, content)
+    return path
+  }
+}
+
+describe('VerdictFile', () => {
+  it('a JSON verdict file is returned parsed', () => {
+    const path = VerdictsOnDisk.json('{"ruling":"PASS","findings":[]}')
+    assert.deepEqual(VerdictFile.read(path), { verdict: { ruling: 'PASS', findings: [] } })
+  })
+
+  it.todo('an unreadable verdict file is a discard, not a crash')
+})
