import { writeFile } from "node:fs/promises";
import { defineConfig } from "@breaklint/public-config";
const config = defineConfig({
  gate: { changes: "introduced-or-worsened", minimumSeverity: "warning" },
});
await writeFile("breaklint.policy.json", JSON.stringify(config, null, 2) + "\n");
