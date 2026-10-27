// Official installed Convex generators, without a remote staging/deploy request.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { apiCodegen } from "../node_modules/convex/dist/esm/cli/codegen_templates/api.js";
import { serverCodegen } from "../node_modules/convex/dist/esm/cli/codegen_templates/server.js";

const config = await readFile("convex/convex.config.ts", "utf8");
const declarations = [
  ...config.matchAll(/^\s+([A-Z][A-Z0-9_]*): v\.optional\(v\.string\(\)\),/gm),
];
if (
  declarations.length !== [...config.matchAll(/^\s+[A-Z][A-Z0-9_]*:/gm)].length
)
  throw new Error(
    "Local generation supports only this project's optional string env declarations; update the generator for a new validator shape",
  );
async function modulePaths(dir, prefix = "") {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.name.startsWith("_")) continue;
    if (item.isDirectory())
      result.push(
        ...(await modulePaths(`${dir}/${item.name}`, `${prefix}${item.name}/`)),
      );
    else if (
      /^[^.]+\.tsx?$/.test(item.name) &&
      /^\s*(import|export)/m.test(await readFile(`${dir}/${item.name}`, "utf8"))
    )
      result.push(`${prefix}${item.name}`);
  }
  return result.sort();
}
const api = apiCodegen(await modulePaths("convex"));
await writeFile("convex/_generated/api.d.ts", api.DTS);
await writeFile("convex/_generated/api.js", api.JS);
const generated = serverCodegen({
  useTypeScript: false,
  envVars: declarations.map(([, name]) => [
    name,
    { type: "value", value: '{"type":"string"}', optional: true },
  ]),
});
await writeFile("convex/_generated/server.d.ts", generated.DTS);
await writeFile("convex/_generated/server.js", generated.JS);
console.log("Generated Convex bindings locally (no remote request).");
