// Lets node run our .ts sources directly (type stripping) while the agent's
// own files keep bundler-style extensionless relative imports.
import { register } from "node:module";
register(new URL("./ts-resolve-loader.mjs", import.meta.url));
