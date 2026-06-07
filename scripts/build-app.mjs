import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const versionSource = await readFile("src/app/version.ts", "utf8");
const cacheName = readConstString(versionSource, "CACHE_NAME")
  ?? `delivery-master-install-${readConstString(versionSource, "CACHE_VERSION")}`;
if (!cacheName || cacheName.includes("undefined")) {
  throw new Error("Missing CACHE_NAME or CACHE_VERSION in src/app/version.ts");
}

await rm("dist", { recursive: true, force: true });
await mkdir("dist/assets", { recursive: true });
await cp("public", "dist", { recursive: true });
await writeFile(
  "dist/sw.js",
  (await readFile("dist/sw.js", "utf8")).replace("__DELIVERY_MASTER_CACHE_NAME__", cacheName),
);

await build({
  entryPoints: ["src/app/main.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "dist/assets/app.js",
  sourcemap: true,
});

function readConstString(source, name) {
  const direct = source.match(new RegExp(`export const ${name} = "([^"]+)"`));
  if (direct) return direct[1];
  const template = source.match(new RegExp("export const " + name + " = `([^`]+)`"));
  if (!template) return undefined;
  return template[1].replace(/\$\{CACHE_VERSION\}/g, readConstString(source, "CACHE_VERSION") ?? "");
}
