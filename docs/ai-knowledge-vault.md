# Penguin AI Knowledge Vault

Status: Product Blueprint Draft
Date: 2026-05-31

## Product Direction

Penguin should become a local-first AI knowledge vault for code, APIs, configs, logs, credentials, investigations, repo knowledge, and manual notes.

It should feel like:

- Obsidian for local vault, Markdown files, links, backlinks, and knowledge relationships.
- Notion for clean writing, slash-command blocks, tables, and document editing.
- Penguin for developer modules, API tooling, MCP integration, and engineering context.

The product should not be only an API client.
The product should not be only a note app.

It should become a shared memory layer between the user, Codex, Claude Code, and developer tools.

## Core Problem

Useful information is currently scattered across many places:

- Obsidian or random Markdown files.
- Notion pages.
- Penguin request tabs and history.
- AI chat conversations.
- Aliyun MCP log search results.
- Repo/code investigation notes.
- Lark messages or docs.
- Browser tabs.
- Screenshots.
- Temporary files.
- Config knowledge kept only in memory.
- Credentials and OTP notes stored separately.

The product should solve this problem:

> When the user finds something useful, there should be one local place to capture it, organize it, search it, link it, and let AI agents reuse it later.

## Product Thesis

Penguin becomes a local AI memory vault.

The user should be able to open Penguin and answer:

- What do I know?
- What did I try?
- What failed?
- Which repo/config/API/log produced this conclusion?
- Which credentials or internal notes are related, if I explicitly open them?
- What did AI learn last time?
- What can be reused next time?
- What can Codex or Claude Code query before working?

## Product Shape

Penguin should be a developer knowledge workspace with modules.

The knowledge vault is the product shell.
Protocol clients are modules inside the shell.

Core product areas:

- Notes and manual recording.
- Knowledge graph.
- Repo knowledge.
- Investigation cases.
- Sensitive credential records.
- Search and retrieval.
- AI/MCP access.
- Protocol tools for gRPC, gRPC-Web, JS-SDK, and later REST.

The important product shift:

```text
Old mental model:
Penguin = API client with history and config

New mental model:
Penguin = local AI knowledge vault with protocol tools
```

This means gRPC, gRPC-Web, and JS-SDK should still exist, but they should be one group of modules rather than the whole application.

## Design Principles

### Local First

The user owns the data.
Markdown files and attachments stay on the local machine unless the user chooses a sync folder or Git workflow.

### Markdown First

Markdown is the durable source of truth.
SQLite is for indexing, app state, fast search, graph edges, and cached derived data.

### Manual Capture First

The first version should make manual recording excellent.
Protocol calls, logs, and AI outputs can be attached only when the user intentionally saves them.

### AI Can Read, But Must Not Leak

AI agents can query non-sensitive vault knowledge through MCP.
Sensitive pages, credential pages, and locked notes are excluded by default.

### Graph Is Data, Not Decoration

The relationship graph must be useful before any visual graph view exists.
Search, backlinks, related notes, context panel, and MCP tools all use the same graph index.

### Developer Tool, Not Admin Dashboard

The UI should feel like a focused developer workspace.
Avoid overview cards, statistics panels, marketing surfaces, and admin-portal patterns unless a specific module needs them.

## Reference Products

### Obsidian

Penguin should learn:

- Local vault concept.
- Markdown files as source of truth.
- File tree navigation.
- Links and backlinks.
- Graph-style relationship thinking.
- Properties/frontmatter.
- Search across notes.
- Knowledge base as a folder, not a locked database.

### Notion

Penguin should learn:

- Clean document-first editor.
- Slash commands such as `/h1`, `/numbering`, `/table`.
- Large page title and calm writing space.
- Block-based editing.
- Tables and structured records.
- A page can be both freeform writing and structured data.

### Penguin

Penguin already has:

- gRPC/gRPC-Web/JS-SDK package installation.
- Request workspace.
- Environment/config management.
- SQLite app persistence.
- MCP integration.
- Developer-oriented workflows.

The AI vault should build on this instead of replacing everything blindly.

## UI Concept

The UI should combine Obsidian-style navigation with Notion-style editing.

Main layout:

```text
Icon Rail | Vault Sidebar | Page Editor | Context Panel
```

The context panel can be collapsed.

### Icon Rail

The icon rail is the primary top-level navigation.

Sections:

- Vault
- Inbox
- Cases
- Knowledge
- Repos
- Credentials
- Search
- Settings

### Vault Sidebar

The sidebar shows folders and pages for the selected section.

It should feel like a local file tree:

```text
Inbox
  2026-05-31 Quick Note
  FPMS Log Snippet

Cases
  Brazil GameURL Issue
  UAT Withdraw Not Updated

Knowledge
  providerId
  X_ENV_TAG
  APISIX Routing

Repos
  fpms-provider
  auth-player

Credentials
  Github
  Apple Account
```

### Page Editor

The page editor should feel Notion-like.

Core interactions:

- Type normally to write text.
- Type `/` to open a block menu.
- Use large page title.
- Use Markdown-backed blocks.
- Keep the page calm and document-first.
- Avoid a dashboard-heavy look.

Standard slash blocks:

- `/text`
- `/h1`
- `/h2`
- `/h3`
- `/bullet`
- `/numbering`
- `/todo`
- `/table`
- `/quote`
- `/code`
- `/divider`
- `/callout`

Penguin slash blocks:

- `/finding`
- `/request`
- `/response`
- `/config`
- `/trace`
- `/repo`
- `/api`
- `/credential-ref`
- `/ai-summary`

### Context Panel

The context panel shows structured context for the current page.

Possible content:

- Page properties.
- Tags.
- Backlinks.
- Related notes.
- Related cases.
- Related repos.
- Linked API methods.
- Linked config keys.
- Linked trace ids or reqids.
- AI-readable summary.
- Sensitive access state.

## Core User Workflows

### Fast Manual Capture

The user opens Penguin, presses new note, writes or pastes anything, and saves it into Inbox.

Useful captures:

- A Lark message.
- A log snippet.
- A trace id.
- A config JSON fragment.
- A repo finding.
- A question to investigate later.
- A screenshot.
- A credential reminder.

The capture should not force the user to pick a perfect folder first.

### Turn Capture Into Knowledge

An Inbox note can later become:

- A Case when it is investigation-specific.
- A Knowledge note when it is reusable.
- A Repo note when it describes a codebase.
- A Credential note when it is sensitive account material.

The product should support changing `type` and moving the Markdown file without breaking links.

### Investigation Case

The user creates or opens a Case and records:

- Problem.
- Scope.
- Environment.
- Identifiers.
- Evidence.
- Repo findings.
- Logs.
- Decision.
- Final conclusion.

The Case becomes the reusable memory for future similar incidents.

### Repo Knowledge Scan

Codex or Claude Code can scan a repo and write structured notes back into Penguin.

The result should not be a giant dump.
It should create or update focused repo notes:

- Repo overview.
- Important modules.
- API entry points.
- Config keys.
- Database tables.
- Redis keys.
- External services.
- Known debugging paths.
- Open uncertainties.

### AI Reuse

Before Codex or Claude Code answers a project-specific question, it can query Penguin MCP.

Example:

```text
User asks: why is GetLoginURL returning empty gameURL?

AI searches:
- cases mentioning GetLoginURL
- knowledge note for providerId
- repo notes for provider service
- trace ids related to empty gameURL
- config keys related to X_ENV_TAG
```

The assistant then answers with stronger continuity because it can reuse prior findings.

### Credential Lookup

Credentials are intentionally separate.

The user can record sensitive notes in Penguin, but AI cannot read them unless the user explicitly unlocks or shares a specific credential reference.

Example:

```text
Normal AI search:
Credential page is hidden.

User unlocks Credentials:
Credential title and safe metadata can appear.

User explicitly opens a credential page:
The secret content is visible only in the app session.
```

## Vault

Vault is the root local knowledge space.

It contains all Markdown notes and attachments.

Default path:

```text
~/.penguin/vault
```

The vault path should be configurable so users can choose:

- iCloud Drive.
- Dropbox.
- A Git repo.
- An existing Obsidian vault.
- Another local folder.

Rules:

- Markdown files are the source of truth.
- SQLite is used for indexes and app state.
- The user can read the notes without Penguin.
- AI agents can access the vault through Penguin MCP.
- Penguin should never require notes to live only inside SQLite.

## Storage Structure

Default storage:

```text
~/.penguin/
  penguin.sqlite3
  vault/
    inbox/
    cases/
    knowledge/
    repos/
    credentials/
    attachments/
```

Example:

```text
~/.penguin/vault/
  inbox/
    2026-05-31-quick-note.md
    fpms-log-snippet.md

  cases/
    brazil-gameurl-issue.md
    uat-withdraw-not-updated.md

  knowledge/
    provider-id.md
    x-env-tag.md
    fpms-routing.md

  repos/
    fpms-provider.md
    auth-player.md

  credentials/
    github.md
    apple-account.md

  attachments/
    screenshot-001.png
    log-uat-001.txt
```

## Markdown Format

Use normal Markdown with YAML frontmatter.

### Case Note

```md
---
type: case
status: investigating
tags:
  - fpms
  - gameurl
env:
  - QAT
related:
  - providerId
  - GetLoginURL
sensitive: false
created: 2026-05-31
updated: 2026-05-31
---

# Brazil GameURL Issue

## Problem

Player login succeeds, but provider returns empty gameURL.

## Evidence

- Aliyun log search found successful login response.
- providerId is 2043.
- gameURL is empty.

## Finding

Need verify provider config and game maintenance state.
```

### Knowledge Note

```md
---
type: knowledge
tags:
  - config
  - env
sensitive: false
created: 2026-05-31
updated: 2026-05-31
---

# X_ENV_TAG

`X_ENV_TAG` is passed as request metadata/header to route environment-specific behavior.
```

### Repo Note

```md
---
type: repo
repo_path: /Users/shieng/Desktop/Projects/fpms-provider
tags:
  - fpms
sensitive: false
created: 2026-05-31
updated: 2026-05-31
---

# fpms-provider

## Purpose

Provider integration service.

## Important Areas

- Login URL generation.
- Provider config lookup.
- Game maintenance behavior.
```

### Credential Note

```md
---
type: credential
sensitive: true
ai_access: denied
mcp_access: denied
tags:
  - account
  - internal
created: 2026-05-31
updated: 2026-05-31
---

# Github

## Account

email:

## Recovery / OTP Notes

Keep setup notes here only if the page is protected.
```

Credential pages are allowed, but they are not ordinary knowledge notes.

Credential rules:

- Sensitive by default.
- Excluded from AI access by default.
- Excluded from MCP access by default.
- Should not appear in normal knowledge search unless explicitly included.
- Should support lock/encryption.

## SQLite Responsibilities

SQLite stores derived/index data and app state.

Possible tables:

```text
pages
- id
- title
- path
- type
- tags
- sensitive
- updated_at

links
- from_page_id
- to_page_id
- relation_type

search_index
- page_id
- content_text
- include_sensitive

graph_edges
- source_id
- target_id
- source_type
- target_type
- relation_type

entities
- id
- type
- value
- normalized_value

entity_mentions
- entity_id
- page_id
- source
- line
- confidence

app_kv
- vault_path
- current_page
- sidebar_state
- editor_state
```

SQLite should not be the only copy of note content.

## Detailed Storage Model

### Files

Markdown files store human-readable content.

Attachments store binary or raw evidence:

```text
attachments/
  images/
  logs/
  json/
  exports/
```

A page can reference an attachment with normal Markdown:

```md
![h5 transaction screenshot](../attachments/images/h5-transaction-bethistory.png)

[raw aliyun log](../attachments/logs/qat-empty-gameurl.log)
```

### Frontmatter Contract

Every vault page should support this common frontmatter shape:

```yaml
id: page_01J...
type: inbox | case | knowledge | repo | credential
title: Brazil GameURL Issue
status: draft | active | resolved | archived
tags:
  - fpms
sensitive: false
ai_access: allowed | denied
mcp_access: allowed | denied
created: 2026-05-31T00:00:00+08:00
updated: 2026-05-31T00:00:00+08:00
```

Optional relationship fields:

```yaml
related:
  - providerId
repos:
  - /Users/shieng/Desktop/Projects/FPMS-NT-Provider
apis:
  - FrontendGameProviderService.GetLoginURL
env:
  - QAT
trace_ids:
  - 3d0e36a6692db4287945845aac2e9178
reqids:
  - c39710d7-a3e7-488d-96b4-2a7cfb13c5fb-1780039611386-118
entities:
  - platformId:50
```

### SQLite Tables

Suggested tables:

```sql
pages (
  id text primary key,
  path text not null unique,
  title text not null,
  type text not null,
  status text,
  sensitive integer not null default 0,
  ai_access text not null default 'allowed',
  mcp_access text not null default 'allowed',
  created_at text,
  updated_at text,
  indexed_at text
);

page_tags (
  page_id text not null,
  tag text not null,
  primary key (page_id, tag)
);

links (
  id text primary key,
  from_page_id text not null,
  to_page_id text,
  raw_target text not null,
  relation_type text not null,
  source text not null
);

entities (
  id text primary key,
  type text not null,
  value text not null,
  normalized_value text not null,
  unique (type, normalized_value)
);

entity_mentions (
  id text primary key,
  entity_id text not null,
  page_id text not null,
  source text not null,
  line integer,
  confidence real
);

attachments (
  id text primary key,
  page_id text,
  path text not null,
  mime_type text,
  byte_size integer,
  sensitive integer not null default 0
);

app_kv (
  key text primary key,
  value text not null,
  updated_at text
);
```

This extends the current Penguin SQLite direction.
Existing app state can remain in `app_kv`; vault-specific tables can be added beside it.

## Content Areas

### Inbox

Inbox is for fast manual capture.

Examples:

- Random notes.
- JSON.
- Logs.
- AI answers.
- Debug thoughts.
- Config notes.
- Links.
- Temporary findings.
- Things that do not have a home yet.

Inbox items can be organized into:

- Case notes.
- Knowledge notes.
- Repo notes.
- Credential notes, only when explicitly marked sensitive.

### Cases

Cases are investigation/problem records.

Examples:

- Brazil Login GameURL Issue
- UAT Withdraw Not Updated
- QAT APISIX Upstream Error
- Player Register Debug

A Case can contain:

- Problem statement.
- Timeline.
- Evidence.
- Log snippets.
- Repo findings.
- Config findings.
- AI summary.
- Final conclusion.
- Next time checklist.

### Knowledge

Knowledge notes are reusable long-term notes.

Examples:

- `providerId`
- `X_ENV_TAG`
- `APISIX routing`
- `GetLoginURL`
- `notify-withdrawal`
- `platformId`

Knowledge notes should be short, searchable, and linkable.

### Repos

Repos contain repository knowledge.

Repos can include both manual repo notes and AI-generated repo scan output from Codex or Claude Code.

Possible repo relationships:

```text
repo -> package -> module -> file -> function
function -> variable -> config key -> environment
API method -> request body -> response field -> backend code path
incident -> trace id -> request -> service -> repo file
config JSON -> environment -> header -> request behavior
case -> notes -> evidence -> conclusion
```

### Credentials

Credentials are sensitive local-only records.

Examples:

- Github account.
- Apple account.
- Internal system account.
- OTP setup note.
- Recovery note.
- Token note.

Credentials are part of the vault because the user may want one local place to record them.

But they must be treated differently from normal notes:

- They are sensitive by default.
- They should have a visible locked/sensitive state.
- They should not be indexed into AI-readable knowledge by default.
- They should not be exposed to MCP by default.
- They should support encryption or password lock.

## Protocol Calls

Penguin protocol calls should not become knowledge automatically.

Most gRPC/gRPC-Web/JS-SDK calls are temporary tests:

- Trying request bodies.
- Testing headers.
- Checking token/env behavior.
- Debugging package or method shape.

Rules:

- Protocol call history stays short-term.
- It remains available in Penguin history.
- It becomes knowledge only when the user explicitly saves it.
- Saved protocol calls can be linked as evidence in a Case.

This prevents the vault from becoming noisy.

## High-Value Knowledge Sources

The highest-value knowledge usually comes from investigations, not raw API calls.

Important sources:

- Aliyun MCP log search results.
- Trace ids.
- Reqids.
- Player ids.
- Proposal ids.
- API paths.
- Repo/code analysis by Codex or Claude Code.
- Config provenance.
- Environment differences.
- AI investigation summaries.
- Manual notes from the user.

Penguin should make these easy to save, search, and link.

## AI Agent Knowledge Base

Penguin should expose knowledge through MCP.

Codex and Claude Code should be able to use Penguin as durable project memory.

Possible MCP knowledge tools:

- `search_knowledge`
- `get_page`
- `create_page`
- `append_note`
- `remember_finding`
- `link_evidence`
- `search_cases`
- `search_repo_graph`
- `scan_repo`
- `summarize_case`

### MCP Tool Contracts

The MCP layer should expose knowledge as structured tools, not raw filesystem access only.

Suggested tool set:

```text
vault_search
- Query non-sensitive pages.
- Filters: type, tags, repo, env, entity, updated range.

vault_get_page
- Read one page by id, path, or title.
- Respects sensitive access rules.

vault_create_page
- Create a Markdown page with frontmatter.

vault_append_note
- Append a section to an existing page.

vault_link_pages
- Add a relationship between two pages.

vault_remember_finding
- Save a finding with source evidence and optional case link.

vault_search_graph
- Query links, backlinks, and entity relationships.

vault_scan_repo
- Ask an agent/tool to scan a repo and write repo knowledge notes.

vault_attach_evidence
- Attach log text, JSON, screenshot path, or API response to a page.
```

Sensitive behavior:

```text
Default:
MCP cannot read credential pages.
MCP cannot read pages with ai_access=denied or mcp_access=denied.
MCP can return a redacted placeholder that says a sensitive linked page exists.

Explicit unlock:
Only the current app session can unlock sensitive pages.
MCP access still requires explicit per-call or per-session permission.
```

### AI Write Policy

AI should not silently rewrite user notes.

Recommended rules:

- AI can create draft notes.
- AI can append evidence to a Case.
- AI can suggest links.
- AI can propose frontmatter updates.
- AI should not overwrite credential pages.
- AI should not mark a Case resolved unless the user approves or explicitly asks.
- AI-generated repo scans should include source repo path and scan time.

Important MCP rules:

- Sensitive credential pages are excluded by default.
- AI agents should search Penguin before answering project-specific questions.
- AI agents should be able to save findings back into Penguin.
- AI agents should preserve links to repo files, config keys, trace ids, and cases.

Goal:

Codex and Claude Code become smarter over time because Penguin keeps durable, searchable, linked project knowledge.

## Knowledge Graph And Links

Graph links are required.

Penguin should support graph-style relationships as a core part of the vault, not just as a visual extra.

The graph does not need to be visually fancy to be valuable.
The important part is that relationships are queryable.

Example questions:

- Where is `platformId` used?
- Which requests depend on `X_ENV_TAG`?
- Which past cases mentioned `providerId`?
- Which repo owns `GetLoginURL`?
- What did we learn last time this response had empty `gameURL`?
- Which credentials are related to this repo, if I unlock sensitive search?

Possible relationships:

- Page links.
- Backlinks.
- Repo/file/function references.
- Config key references.
- API method references.
- Trace id references.
- Case-to-finding links.
- Credential references, sensitive and access-controlled.

Required link capabilities:

- Wikilinks between pages, such as `[[providerId]]` and `[[Brazil GameURL Issue]]`.
- Backlinks showing which pages mention the current page.
- Unlinked mentions, such as text that mentions `providerId` before a link exists.
- Frontmatter relationships, such as `related`, `repos`, `apis`, `env`, and `trace_ids`.
- Tag links, such as `#fpms`, `#config`, and `#uat`.
- Entity links extracted from content, such as `trace_id`, `reqid`, `playerId`, `proposalId`, API method names, config keys, repo paths, file paths, function names, and environment names.
- Sensitive links for credential references, hidden unless sensitive access is unlocked.

Required graph index examples:

```text
case -> knowledge
case -> repo
case -> trace_id
case -> config_key
case -> api_method
case -> credential_ref
repo -> file_path
file_path -> function_name
function_name -> config_key
config_key -> environment
api_method -> request_field
api_method -> response_field
```

Markdown examples:

```md
This issue is related to [[providerId]] and [[GetLoginURL]].

Trace id: `3d0e36a6692db4287945845aac2e9178`
Player id: `1205576282`
Repo: `fpms-provider`
Config key: `X_ENV_TAG`
```

Frontmatter example:

```yaml
related:
  - providerId
  - GetLoginURL
repos:
  - fpms-provider
apis:
  - GetLoginURL
env:
  - QAT
trace_ids:
  - 3d0e36a6692db4287945845aac2e9178
```

The graph should be useful even before a full graph visualization exists. Search, context panel, backlinks, and MCP tools should all use the graph index.

### Graph Engine Behavior

The graph engine has three jobs:

1. Parse explicit links.
2. Detect unlinked entities.
3. Keep the relationship index up to date.

Explicit links:

```md
[[providerId]]
[[Brazil GameURL Issue]]
[[repo:/Users/shieng/Desktop/Projects/FPMS-NT-Provider]]
[[api:FrontendGameProviderService.GetLoginURL]]
[[trace:3d0e36a6692db4287945845aac2e9178]]
```

Unlinked entity detection:

```text
platformId
providerId
playerId
proposalId
trace_id
traceId
reqid
X_ENV_TAG
GetLoginURL
FrontendTransactionHistoryService.GetBetRecordTransactionHistory
/Users/shieng/Desktop/Projects/...
src/modules/payment/...
```

Index refresh triggers:

- Page created.
- Page edited.
- Page moved or renamed.
- Attachment added.
- Repo scan imported.
- AI finding saved.
- Config JSON synced.

Conflict behavior:

- If a wikilink target does not exist, keep it as unresolved.
- If an entity matches multiple pages, show candidates instead of guessing.
- If a linked page is sensitive, show only safe metadata unless unlocked.

### Graph Views

Graph data should appear in practical places before building a full canvas.

Required first surfaces:

- Backlinks in context panel.
- Related pages list.
- Entity mentions list.
- Case evidence links.
- MCP graph query.

Optional later surface:

- Visual graph canvas.

## Security Model

The vault may contain sensitive data:

- Credentials.
- OTP notes.
- Tokens.
- Internal config.
- Player data.
- Log snippets.
- Production incidents.

Rules:

- Everything is local-first.
- Sensitive pages must be marked clearly.
- Sensitive pages should not be auto-uploaded.
- Sensitive pages should not be automatically exposed to AI tools.
- Sensitive pages should not be exposed through MCP by default.
- The product should support locked/encrypted pages.

Suggested frontmatter:

```yaml
sensitive: true
ai_access: denied
mcp_access: denied
```

## Product Modules

The vault can contain modules.

Module examples:

- Markdown editor.
- Inbox capture.
- Case management.
- Knowledge notes.
- Repo notes.
- Credential manager.
- Global search.
- Backlinks.
- Graph/query engine.
- Entity extraction.
- Link indexer.
- MCP knowledge tools.
- Aliyun evidence capture.
- Repo scanner.
- Penguin protocol evidence attachment.
- Config knowledge capture.

The existing gRPC, gRPC-Web, and JS-SDK features become Penguin protocol modules, not the whole product.

## Existing Penguin Module Mapping

Current Penguin app areas map into the new product like this:

| Current Area | New Module | Product Role |
| --- | --- | --- |
| Request tabs | Protocol Workspace | Temporary testing and request execution |
| gRPC packages | Protocol Module | Installed RPC package discovery and calls |
| gRPC-Web packages | Protocol Module | Browser-compatible RPC package discovery and calls |
| JS-SDK packages | Protocol Module | SDK method discovery and calls |
| Environment manager | Config Module | Runtime headers, variables, and config JSON sync |
| History panel | Protocol History | Short-term request memory |
| Saved requests | Saved Evidence Source | Can be linked into Cases when user saves as evidence |
| MCP server | AI Bridge | Lets Codex and Claude Code call tools and read knowledge |
| SQLite app state | App State + Indexes | Stores UI state and derived vault indexes |

This avoids deleting useful protocol tooling while allowing the product to grow beyond API testing.

## Product Information Architecture

Top-level sections:

```text
Vault
Inbox
Cases
Knowledge
Repos
Credentials
Protocol
Search
Settings
```

`Protocol` can contain the current request workspace:

```text
Protocol
  gRPC
  gRPC-Web
  JS-SDK
  REST
  Environments
  Saved Requests
  History
```

The user can live mostly in Vault/Notes, and open Protocol only when testing APIs.

## Editor Requirements

The first editor does not need to be a full Notion clone.
It needs to feel fast and structured.

Required behavior:

- Large editable title.
- Markdown body editor.
- Slash menu for common blocks.
- Table insertion.
- Code block insertion.
- Callout/finding block insertion.
- Link autocomplete for `[[...]]`.
- Tag autocomplete for `#...`.
- Frontmatter editor through a properties panel.
- Save indicator.
- File-backed persistence.

Allowed internal implementation:

- Store plain Markdown files.
- Use editor decorations for blocks.
- Use hidden block ids only if needed for stable table/block editing.

Do not make the first version depend on a proprietary block JSON format.

## Search Requirements

Search should combine:

- Filename/title search.
- Full-text Markdown search.
- Tag filter.
- Type filter.
- Entity filter.
- Backlink lookup.
- Sensitive include toggle after unlock.

Example searches:

```text
providerId GetLoginURL
type:case env:QAT empty gameURL
tag:fpms trace_id
repo:FPMS-NT-Payment GetBetRecordTransactionHistory
entity:playerId:1000026
```

Search result should show:

- Page title.
- Type.
- Snippet.
- Tags.
- Updated time.
- Sensitive marker when applicable.

## Config JSON And Vault

The config JSON sync feature should stay separate from notes, but it can create knowledge.

Recommended behavior:

- Config JSON itself remains app/config data.
- User can manually save a config key or environment as a Knowledge note.
- Config sync can create derived entities such as `platformId`, `X_ENV_TAG`, environment name, and endpoint host.
- It must not overwrite user's local custom config without explicit action.

This keeps operational config safe while still making important config facts searchable.

## Current Decisions

- Product direction: hybrid AI knowledge vault.
- Storage: Markdown files as source of truth.
- Default vault path: `~/.penguin/vault`.
- SQLite role: indexes and app state.
- UI reference: Obsidian sidebar + Notion editor.
- Theme: dark mode first.
- Core areas: Vault, Inbox, Cases, Knowledge, Repos, Credentials, Search.
- Graph links, backlinks, entity links, and relationship indexes are required.
- Manual recording is central.
- Protocol calls are not saved into knowledge automatically.
- Credentials are included but sensitive by default.
- Codex and Claude Code should access non-sensitive knowledge through MCP.

## Working Decisions

- Inbox uses one file per note by default. Daily inbox can be a view later.
- Editor stores Markdown as the durable file format. Hidden block ids are allowed only when needed for editor stability.
- Credentials are represented as vault pages with sensitive frontmatter, but secret fields should be encrypted or locked before the product is treated as safe for real credentials.
- Search excludes sensitive pages by default. Sensitive search requires explicit unlock.
- Penguin should eventually open to the Vault home by default, with Protocol available as a module. During transition, current request workspace can stay as the default screen.
- Existing Obsidian vault import should be supported by selecting a folder as the vault path. Penguin should not require conversion before reading Markdown.

## Still Needs Product Confirmation

- Whether Credentials should use whole-file encryption, field-level encryption, or a separate encrypted SQLite table.
- Whether repo scans should run inside Penguin directly or through Codex/Claude Code MCP calls.
- Whether visual graph canvas is necessary early, or context-panel graph surfaces are enough.
- Whether the first editor should use CodeMirror Markdown mode or a richer block editor library.
