import esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({ sourcemap: false });
await esbuild.build(presets.esbuild.worker);
await esbuild.build(presets.esbuild.manifest);
