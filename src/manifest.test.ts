import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (name: string) =>
  JSON.parse(await readFile(path.join(root, name), "utf8")) as { version: string };

/**
 * The app reads trawl-plugin.json; npm and every habit read package.json.
 * Bumping one alone ships a plugin that is new and announces itself as old,
 * which reads to a user as "the update did not arrive".
 */
it("announces the version that was released", async () => {
  const [manifest, pkg] = await Promise.all([read("trawl-plugin.json"), read("package.json")]);
  expect(manifest.version).toBe(pkg.version);
});
