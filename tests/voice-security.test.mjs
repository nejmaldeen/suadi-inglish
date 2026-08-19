import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else files.push(path);
  }
  return files;
}

test("voice credentials are absent from browser and public artifacts", async () => {
  const roots = ["dist/client", "public"];
  const files = (await Promise.all(roots.map(collectFiles))).flat();
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8").catch(() => "")));
  const joined = contents.join("\n");

  assert.doesNotMatch(joined, /ELEVENLABS_API_KEY/);
  assert.doesNotMatch(joined, /api\.elevenlabs\.io\/v1\/text-to-speech/);
});
