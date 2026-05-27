// proto-parser now lives in @pengvi/core. Kept as a re-export shim so existing
// imports across the codebase keep working unchanged.
export {
  parseProtoContent,
  generateDefaultJson,
  generateMethodPath,
} from "@pengvi/core";
