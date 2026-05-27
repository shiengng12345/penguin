// Protocol-agnostic types shared by Pengvi desktop app and future MCP/CLI
// runtimes. UI-domain types (RequestTab, AppTheme, etc.) stay in the desktop
// app's store.ts — only data shapes that describe RPC traffic live here.

export interface ProtoService {
  name: string;
  fullName: string;
  methods: ProtoMethod[];
}

export interface ProtoMethod {
  name: string;
  fullName: string;
  requestType: string;
  responseType: string;
  requestFields: FieldInfo[];
  responseFields: FieldInfo[];
}

export interface FieldInfo {
  name: string;
  type: string;
  repeated: boolean;
  optional: boolean;
  fields?: FieldInfo[];
  enumValues?: string[];
}

export interface MetadataEntry {
  key: string;
  value: string;
  enabled: boolean;
}

export interface ResponseState {
  status: string;
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  duration: number;
  error?: string;
}

// Connect-RPC generated service descriptor shape. `fields` is the runtime
// protobuf-es descriptor — opaque, typed loosely on purpose.
export interface ConnectMethodDef {
  name?: string;
  kind?: number;
  I?: { typeName: string; fields: Record<string, unknown> };
  O?: { typeName: string };
}

export interface ConnectServiceDef {
  typeName: string;
  methods: Record<string, ConnectMethodDef>;
}
