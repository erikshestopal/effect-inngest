import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/Client.ts", "src/Events.ts", "src/Function.ts", "src/Group.ts", "src/HttpApi.ts"],
  format: "esm",
  dts: true,
  clean: true,
  outDir: "dist",
  unbundle: true,
  fixedExtension: false,
});
