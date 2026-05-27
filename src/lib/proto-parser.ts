// proto-parser now lives in @penguin/core. Kept as a re-export shim so existing
// imports across the codebase keep working unchanged.
export {
  parseProtoContent,
  generateDefaultJson,
  generateMethodPath,
} from "@penguin/core";
