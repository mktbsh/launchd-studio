import type { ManifestCompilation, NormalizeContext } from "../domain";
import { parseManifestJson } from "./json";
import { normalizeManifest } from "./normalize";
import { validateManifestValue } from "./validate";

export function compileManifest(
  source: string,
  context: NormalizeContext,
): ManifestCompilation {
  const parsed = parseManifestJson(source);
  if (parsed.value === undefined) {
    return {
      valid: false,
      diagnostics: parsed.diagnostics,
    };
  }

  const validated = validateManifestValue(parsed.value);
  const diagnostics = [...parsed.diagnostics, ...validated.diagnostics];
  if (validated.manifest === undefined) {
    return {
      valid: false,
      diagnostics,
    };
  }

  return {
    valid: true,
    manifest: normalizeManifest(validated.manifest, context),
    diagnostics,
  };
}
