export interface GrpcJsonRequestType {
  typeName?: string;
  fromJson?: (value: unknown, options?: { ignoreUnknownFields?: boolean }) => unknown;
}

export function normalizeGrpcJsonBody(
  parsedBody: Record<string, unknown>,
  requestType?: GrpcJsonRequestType | null,
): unknown {
  if (!requestType || typeof requestType.fromJson !== "function") {
    return parsedBody;
  }

  try {
    return requestType.fromJson(parsedBody, { ignoreUnknownFields: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const typeName = requestType.typeName ? ` for ${requestType.typeName}` : "";
    throw new Error(`Request body does not match proto schema${typeName}: ${message}`);
  }
}
