import { mkdir, writeFile } from "node:fs/promises";
const prompts = ["Answer with exactly: ready", "Answer with exactly: set"];
const tasks = ["ready", "set"].map((expected, index) => ({ id: `starter-${index + 1}`, kind: "single", prompt: prompts[index], expected, metadata: { seed: 20261015 + index } }));
await mkdir("data", { recursive: true });
await writeFile("data/tasks.jsonl", `${tasks.map((task) => JSON.stringify(task)).join("\n")}\n`);
console.log(`generated ${tasks.length} seeded tasks`);
