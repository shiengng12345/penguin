// Header sanitisation shared by the live send path and the "copy as curl"
// exporters in RequestPanel. Kept dependency-free so it is trivially unit
// testable (see tests/request-headers.test.mjs).

// An Authorization header carries no usable credential when its value is empty
// or is only an auth scheme with nothing after it (e.g. "Bearer " with an empty
// token). Such a header must NOT be sent: the backend treats `Authorization:
// Bearer` as a malformed/empty JWT and rejects the whole call ("JWT Token: User
// is not found"), whereas omitting the header entirely lets the request proceed
// (e.g. anonymous pre-auth lookups like StartFaceVerification → "CPF not
// found"). The row still shows in the tab's header editor as a
// fill-in-your-token template — we just don't transmit it while blank.
//
// Only Authorization is affected; other empty headers (eId, x-env-tag, …) keep
// their existing behaviour so this change stays scoped to the reported bug.
export function isEmptyAuthHeader(key: string, value: string): boolean {
  if (key.trim().toLowerCase() !== "authorization") return false;
  const trimmed = value.trim();
  return trimmed === "" || /^(bearer|basic|digest)$/i.test(trimmed);
}
