# REST API V1 Design

## Goal

Add REST API support as a first-class Pengvi protocol while preserving the existing gRPC-Web, gRPC, and SDK workflows.

## Approved Decisions

- Delivery path: start with Manual REST, reserve data model space for future OpenAPI import.
- URL model: support both full URLs and environment-based paths.
- Body model: support JSON and raw text.
- Response model: show response tabs for Pretty, Raw, and Headers.

## Product Scope

REST V1 adds a fourth protocol named `rest`.

Users can:

- Create or switch a tab to REST.
- Pick an HTTP method: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.
- Enter either a full URL, a `{{URL}}/path` URL, or a path-only URL such as `/v1/users`.
- Edit headers with the same metadata table used by existing protocols.
- Edit request body in JSON mode or raw text mode.
- Send through the existing Tauri HTTP proxy.
- Inspect response status, duration, Pretty, Raw, and Headers.
- Save REST requests.
- Reopen REST requests from history or saved requests.
- Copy a REST request as cURL.

## Out Of Scope For V1

- OpenAPI import and endpoint tree generation.
- Multipart form-data.
- Binary request bodies.
- File upload.
- Authentication helpers beyond editable headers.
- REST environment matrix runner.

## URL Resolution

REST send resolves the final URL in this order:

1. If the input becomes an absolute URL after environment interpolation, use it directly.
2. If the input starts with `/`, use active environment variable `URL` as the base and append the path.
3. If the input is relative without a leading slash, use active environment variable `URL` as the base and append it as a path segment.
4. If no base URL can be found, show a request error before sending.

The tab stores the user's original URL input. History and saved requests preserve that original input. The response can display the resolved URL for debugging.

## Body Modes

REST tabs store `restBodyMode`.

- `json`: body uses the existing JSON editor, format action, and JSON validation before send.
- `raw`: body uses a plain text editor and sends the text as-is.

Default REST body mode is `json`.

Default REST headers include:

- `Authorization`
- `Content-Type: application/json`
- `x-env-tag`
- `platform-id`

Users can edit or disable any default header.

## Response Tabs

REST response uses the same response state shape as existing protocols, with UI tabs:

- `Pretty`: format JSON when response body parses as JSON. Otherwise show raw body.
- `Raw`: show response body exactly as text.
- `Headers`: show response headers as key-value rows.

## Architecture

REST should be implemented as an additive protocol path, not as a special case mixed into gRPC method selection.

New or updated units:

- `src/lib/rest.ts`: REST pure helpers, including method constants, body mode constants, URL resolution, header conversion, and cURL generation.
- `src/lib/rest-client.ts`: Tauri/browser REST send wrapper using the existing `proxyFetch`.
- `src/lib/store.ts`: add `rest` to protocol state and tab fields.
- `src/hooks/useEnvironments.ts`: add REST environment persistence and config sync.
- `src/components/layout/UrlBar.tsx`: render REST method + URL controls.
- `src/components/request/RequestPanel.tsx`: route REST sends, body mode toggle, REST cURL copy.
- `src/components/request/ResponsePanel.tsx`: Pretty, Raw, Headers tabs for REST responses.
- `src/components/layout/Sidebar.tsx`: REST sidebar empty-state / saved endpoints surface for V1.

## Compatibility

Existing gRPC-Web, gRPC, and SDK behavior must remain unchanged.

Existing stored tabs, history, and saved requests may not have REST fields. The app must default missing REST fields safely:

- `restMethod`: `POST`
- `restBodyMode`: `json`
- `targetUrl`: `{{URL}}`
- `requestBody`: `{}`

## Verification

Minimum verification:

- Unit tests for REST URL resolution and cURL generation.
- Unit tests for existing package spec behavior remain passing.
- TypeScript check for app and packages.
- `pnpm build`.
- `cargo check --manifest-path src-tauri/Cargo.toml --quiet`.
- Browser verification for REST tab UI and request composition where possible.
