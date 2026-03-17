import { invoke } from "@tauri-apps/api/core";

export interface MongoConnectionDraft {
  name: string;
  uri: string;
  tag?: string | null;
}

export interface MongoConnectionRecord extends MongoConnectionDraft {
  id: string;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt?: number | null;
  connected: boolean;
}

export interface MongoDatabaseInfo {
  name: string;
  sizeOnDisk: number;
  empty: boolean;
}

export interface MongoCollectionInfo {
  name: string;
  documentCount?: number | null;
}

export interface MongoFindOptions {
  filter?: string | null;
  projection?: string | null;
  sort?: string | null;
  collation?: string | null;
  hint?: string | null;
  maxTimeMs?: number | null;
  skip?: number | null;
  limit?: number | null;
  summaryOnly?: boolean | null;
}

export interface MongoFindResponse {
  documents: Array<Record<string, unknown>>;
  count: number;
}

export interface MongoInsertResult {
  insertedCount: number;
}

export interface MongoUpdateResult {
  matchedCount: number;
  modifiedCount: number;
}

export interface MongoDeleteResult {
  deletedCount: number;
}

export async function listMongoConnections() {
  return invoke<MongoConnectionRecord[]>("mongo_list_connections");
}

export async function addMongoConnection(draft: MongoConnectionDraft) {
  return invoke<MongoConnectionRecord>("mongo_add_connection", { draft });
}

export async function updateMongoConnection(id: string, draft: MongoConnectionDraft) {
  return invoke<MongoConnectionRecord>("mongo_update_connection", { id, draft });
}

export async function deleteMongoConnection(id: string) {
  return invoke<void>("mongo_delete_connection", { id });
}

export async function testMongoConnection(draft: MongoConnectionDraft) {
  return invoke<string>("mongo_test_connection", { draft });
}

export async function connectMongoConnection(id: string) {
  return invoke<string>("mongo_connect", { id });
}

export async function disconnectMongoConnection(id: string) {
  return invoke<void>("mongo_disconnect", { id });
}

export async function listMongoDatabases(id: string) {
  return invoke<MongoDatabaseInfo[]>("mongo_list_databases", { id });
}

export async function listMongoCollections(id: string, db: string) {
  return invoke<MongoCollectionInfo[]>("mongo_list_collections", { id, db });
}

export async function findMongoDocuments(
  id: string,
  db: string,
  collection: string,
  options?: MongoFindOptions | null,
) {
  return invoke<MongoFindResponse>("mongo_find_documents", { id, db, collection, options });
}

export async function countMongoDocuments(
  id: string,
  db: string,
  collection: string,
  options?: MongoFindOptions | null,
) {
  return invoke<number>("mongo_count_documents", { id, db, collection, options });
}

export async function getMongoDocument(
  id: string,
  db: string,
  collection: string,
  documentId: unknown,
) {
  return invoke<Record<string, unknown>>("mongo_get_document", {
    id,
    db,
    collection,
    documentId,
  });
}

export async function insertMongoDocument(
  id: string,
  db: string,
  collection: string,
  document: Record<string, unknown>,
) {
  return invoke<MongoInsertResult>("mongo_insert_document", { id, db, collection, document });
}

export async function updateMongoDocument(
  id: string,
  db: string,
  collection: string,
  documentId: unknown,
  document: Record<string, unknown>,
) {
  return invoke<MongoUpdateResult>("mongo_update_document", {
    id,
    db,
    collection,
    documentId,
    document,
  });
}

export async function deleteMongoDocuments(
  id: string,
  db: string,
  collection: string,
  documentIds: unknown[],
) {
  return invoke<MongoDeleteResult>("mongo_delete_documents", {
    id,
    db,
    collection,
    documentIds,
  });
}
