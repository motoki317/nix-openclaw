import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fixture, patch, load, envFor, restoreEnv, snapshot, change } from "./patch-openclaw-npm-dist.fixtures.mjs";

function uiFixture(t, upstreamPolicy = false) {
  const f = fixture(t, "mjs");
  fs.writeFileSync(path.join(f.root, "dist/control-ui-assets-fixture.mjs"), `
async function root(_rootDir, options) { return options; }
async function readPluginControlUiAssets(rootDir, declaration${upstreamPolicy ? ", options = {}" : ""}) {
\tconst pluginRoot = await root(rootDir, {
\t\thardlinks: ${upstreamPolicy ? 'options.rejectHardlinks === false ? "allow" : "reject"' : '"reject"'},
\t\tsymlinks: "reject",
\t\tmaxBytes: 4194304
\t});
  return pluginRoot;
}
export { readPluginControlUiAssets };
`);
  fs.writeFileSync(path.join(f.root, "dist/control-ui-plugin-assets-fixture.mjs"), `
function loadPluginManifest(_root, rejectHardlinks) { return rejectHardlinks; }
${upstreamPolicy ? `import { t as shouldRejectHardlinkedPluginFiles } from "./${f.policy}";
import { readPluginControlUiAssets } from "./control-ui-assets-fixture.mjs";
function createPluginCache() { return {}; }
function withPluginCache(_cache, callback) { return callback(); }
export async function snapshotBrowserBuild(record, declaration) {
  return await readPluginControlUiAssets(record.rootDir, declaration, { rejectHardlinks: shouldRejectHardlinkedPluginFiles({
\t\torigin: record.origin,
\t\trootDir: record.rootDir
\t}) });
}
export function reload(record) {
  const rootDir = record.rootDir;
\t\t\t\tif (!rootDir) throw new Error("plugin is no longer active");
\t\t\t\tconst rejectManifestHardlinks = shouldRejectHardlinkedPluginFiles({
\t\t\t\t\torigin: record.origin,
\t\t\t\t\trootDir
\t\t\t\t});
\t\t\t\tconst loaded = withPluginCache(createPluginCache(), () => loadPluginManifest(rootDir, rejectManifestHardlinks, rootDir));
  return loaded;
}` : "export function reload(record) { return loadPluginManifest(record.rootDir, true, record.rootDir); }"}
`);
  return f;
}

for (const upstreamPolicy of [false, true]) test(`Control UI ${upstreamPolicy ? "upstream" : "patched"} assets and reload preserve hardlink policy`, async (t) => {
  const f = uiFixture(t, upstreamPolicy);
  const before = snapshot(f).filter(([name]) => name.startsWith("control-ui-"));
  const result = patch(f);
  assert.equal(result.status, 0, result.stderr);
  if (upstreamPolicy) assert.deepEqual(snapshot(f).filter(([name]) => name.startsWith("control-ui-")), before);
  const facts = await load(f, f.dependency);
  const { readPluginControlUiAssets } = await load(f, "control-ui-assets-fixture.mjs");
  const { reload, snapshotBrowserBuild } = await load(f, "control-ui-plugin-assets-fixture.mjs");
  restoreEnv(t);
  for (const [rootDir, canonical, store] of [
    ["/nix/store/plugin", "/nix/store/plugin", true],
    ["/alias", "/nix/store/plugin", true],
    ["/nix/store/escape", "/tmp/plugin", false],
    ["/nix/store-other/plugin", "/nix/store-other/plugin", false],
    ["/tmp/plugin", "/tmp/plugin", false],
  ]) {
    facts.realpaths.set(rootDir, canonical);
    for (const mode of ["0", "1", "true"]) for (const origin of ["config", "global", "bundled"]) {
      Object.assign(process.env, envFor(mode));
      const allowed = upstreamPolicy && origin === "bundled" || mode === "1" && store;
      const record = { rootDir, origin };
      const options = upstreamPolicy ? await snapshotBrowserBuild(record, {}) : await readPluginControlUiAssets(rootDir, {});
      assert.equal(options.hardlinks, allowed ? "allow" : "reject");
      assert.equal(options.symlinks, "reject");
      assert.equal(options.maxBytes, 4194304);
      assert.equal(reload(record), !allowed);
    }
  }
});

for (const [fault, file, from, to] of [
  ["asset-policy", "assets", 'options.rejectHardlinks === false', 'options.rejectHardlinks !== true'],
  ["asset-options", "assets", 'declaration, options = {}', 'declaration, options'],
  ["policy-import", "plugin-assets", '{ t as shouldRejectHardlinkedPluginFiles }', '{ x as shouldRejectHardlinkedPluginFiles }'],
  ["asset-origin", "plugin-assets", 'origin: record.origin', 'origin: "bundled"'],
  ["reload-policy", "plugin-assets", 'loadPluginManifest(rootDir, rejectManifestHardlinks, rootDir)', 'loadPluginManifest(rootDir, false, rootDir)'],
]) test(`unknown upstream Control UI ${fault} fails before any write`, (t) => {
  const f = uiFixture(t, true);
  change(f, `control-ui-${file}-fixture.mjs`, from, to);
  const before = snapshot(f);
  assert.equal(patch(f).status, 1);
  assert.deepEqual(snapshot(f), before);
});

test("unknown Control UI reload layout fails before writing any patch", (t) => {
  const f = uiFixture(t);
  const file = path.join(f.root, "dist/control-ui-plugin-assets-fixture.mjs");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("record.rootDir, true, record.rootDir", "record.rootDir, false, record.rootDir"));
  const before = snapshot(f);
  assert.notEqual(patch(f).status, 0);
  assert.deepEqual(snapshot(f), before);
});
