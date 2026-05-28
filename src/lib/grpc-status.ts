interface GrpcResponseLike {
  status: string;
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  error?: string;
}

interface GrpcStatusMeta {
  name: string;
  explanation: string;
  hint: string;
  retryable: boolean;
}

export interface GrpcStatusSummary {
  code: number;
  name: string;
  title: string;
  message: string;
  transport: string | null;
  explanation: string;
  hint: string;
  retryable: boolean;
}

const GRPC_STATUS: Record<number, GrpcStatusMeta> = {
  1: {
    name: "CANCELLED",
    explanation: "The request was cancelled before the server finished it.",
    hint: "Check whether the request was aborted, timed out by the client, or replaced by another send.",
    retryable: true,
  },
  2: {
    name: "UNKNOWN",
    explanation: "The server returned an unknown error.",
    hint: "Check the raw message and backend logs because the service did not expose a specific gRPC status.",
    retryable: false,
  },
  3: {
    name: "INVALID_ARGUMENT",
    explanation: "The request body or metadata is invalid for this method.",
    hint: "Check required fields, field types, enum values, and headers.",
    retryable: false,
  },
  4: {
    name: "DEADLINE_EXCEEDED",
    explanation: "The call exceeded its deadline before a response was ready.",
    hint: "Check backend latency, gateway timeout, request size, or whether the target service is stuck.",
    retryable: true,
  },
  5: {
    name: "NOT_FOUND",
    explanation: "The requested resource or method target was not found.",
    hint: "Check IDs, route, environment, package version, and selected method.",
    retryable: false,
  },
  6: {
    name: "ALREADY_EXISTS",
    explanation: "The resource already exists.",
    hint: "Check whether this request is a duplicate create/update action.",
    retryable: false,
  },
  7: {
    name: "PERMISSION_DENIED",
    explanation: "The caller is authenticated but not allowed to perform this action.",
    hint: "Check token scope, role, platform-id, eId, and environment headers.",
    retryable: false,
  },
  8: {
    name: "RESOURCE_EXHAUSTED",
    explanation: "The service rejected the request because a quota, rate limit, or resource limit was hit.",
    hint: "Check rate limits, payload size, quota, or service capacity.",
    retryable: true,
  },
  9: {
    name: "FAILED_PRECONDITION",
    explanation: "The request cannot run because the current server-side state is not valid for this action.",
    hint: "Check the player's current state, config state, or prerequisite workflow step.",
    retryable: false,
  },
  10: {
    name: "ABORTED",
    explanation: "The operation was aborted, usually because of a concurrency or transaction conflict.",
    hint: "Retry after checking whether another update is touching the same resource.",
    retryable: true,
  },
  11: {
    name: "OUT_OF_RANGE",
    explanation: "A request value is outside the supported range.",
    hint: "Check pagination, numeric limits, date ranges, and enum numbers.",
    retryable: false,
  },
  12: {
    name: "UNIMPLEMENTED",
    explanation: "The operation is not implemented, not exposed, or not supported by this server.",
    hint: "Check the selected method, package version, environment, and whether the service supports this protocol.",
    retryable: false,
  },
  13: {
    name: "INTERNAL",
    explanation: "The backend hit an internal error while processing the request.",
    hint: "Check backend logs with the same method, environment, player/platform IDs, and timestamp.",
    retryable: false,
  },
  14: {
    name: "UNAVAILABLE",
    explanation: "The service is unavailable. This is usually a transient gateway, network, or upstream service problem.",
    hint: "The upstream service did not respond in time. Check service health, gateway timeout, route/env headers, or backend logs.",
    retryable: true,
  },
  15: {
    name: "DATA_LOSS",
    explanation: "The service reported unrecoverable data loss or corruption.",
    hint: "Escalate with backend logs and the exact request/response payload.",
    retryable: false,
  },
  16: {
    name: "UNAUTHENTICATED",
    explanation: "The request is missing valid authentication.",
    hint: "Check Authorization token, expiry, environment, eId, and platform-id.",
    retryable: false,
  },
};

const HTTP_STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  408: "Request Timeout",
  409: "Conflict",
  415: "Unsupported Media Type",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value;
  }
  return undefined;
}

function parseBody(body: string): { code?: number; message?: string } {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const code = typeof parsed.code === "number"
      ? parsed.code
      : typeof parsed.code === "string"
        ? Number.parseInt(parsed.code, 10)
        : undefined;
    const message = typeof parsed.message === "string"
      ? parsed.message
      : typeof parsed.details === "string"
        ? parsed.details
        : undefined;
    return { code: Number.isFinite(code) ? code : undefined, message };
  } catch {
    return {};
  }
}

function parseStatusCode(status: string): number | undefined {
  const match = status.match(/\bgRPC\s+(\d+)\b/i);
  if (!match) return undefined;
  return Number.parseInt(match[1], 10);
}

export function parseHttpStatusFromMessage(message: string): number | undefined {
  const match = message.match(/\bHTTP\s+(\d{3})\b/i);
  if (!match) return undefined;
  const code = Number.parseInt(match[1], 10);
  return Number.isFinite(code) ? code : undefined;
}

export function summarizeGrpcStatusResponse(response: GrpcResponseLike): GrpcStatusSummary | null {
  const body = parseBody(response.body);
  const codeText = headerValue(response.headers, "grpc-status");
  const headerCode = codeText ? Number.parseInt(codeText, 10) : undefined;
  const candidateCode = Number.isFinite(headerCode)
    ? headerCode
    : body.code ?? parseStatusCode(response.status);

  if (candidateCode === undefined || !Number.isFinite(candidateCode) || candidateCode === 0) {
    return null;
  }
  const code = candidateCode;

  const meta = GRPC_STATUS[code] ?? {
    name: `CODE_${code}`,
    explanation: "The server returned a non-OK gRPC status.",
    hint: "Check grpc-message, response body, and backend logs for this method.",
    retryable: false,
  };
  const message = headerValue(response.headers, "grpc-message") ?? body.message ?? response.error ?? "";
  const httpStatus = parseHttpStatusFromMessage(message);
  const transport = httpStatus
    ? `HTTP ${httpStatus} ${HTTP_STATUS_TEXT[httpStatus] ?? ""}`.trim()
    : message || null;

  return {
    code,
    name: meta.name,
    title: `${meta.name} (${code})`,
    message,
    transport,
    explanation: meta.explanation,
    hint: meta.hint,
    retryable: meta.retryable,
  };
}

export function formatGrpcStatusBadgeLabel(summary: GrpcStatusSummary | null): string | null {
  if (!summary) return null;
  return `gRPC ${summary.title}`;
}
