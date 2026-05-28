const SNSOFT_PACKAGE_SPEC_RE = /^@snsoft\/(?:[\w-]+-(?:grpc-web|grpc)|js-sdk)@[\w.\-T]+$/;

export type SnsoftPackageProtocol = "grpc-web" | "grpc" | "sdk";

export function isAllowedSnsoftPackageSpec(spec: string): boolean {
  return SNSOFT_PACKAGE_SPEC_RE.test(spec.trim());
}

export function snsoftPackageNameFromSpec(spec: string): string | null {
  const trimmed = spec.trim();
  if (!isAllowedSnsoftPackageSpec(trimmed)) return null;
  const atIdx = trimmed.lastIndexOf("@");
  return atIdx > 0 ? trimmed.slice(0, atIdx) : null;
}

export function protocolFromSnsoftPackageSpec(spec: string): SnsoftPackageProtocol | null {
  const name = snsoftPackageNameFromSpec(spec);
  if (!name) return null;
  if (name === "@snsoft/js-sdk") return "sdk";
  if (name.endsWith("-grpc-web")) return "grpc-web";
  if (name.endsWith("-grpc")) return "grpc";
  return null;
}
