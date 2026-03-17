import { invoke } from "@tauri-apps/api/core";

export interface DockerOverview {
  available: boolean;
  context: string | null;
  contextEndpoint: string | null;
  provider: string | null;
  providerLabel: string | null;
  canStartProvider: boolean;
  serverVersion: string | null;
  runningContainers: number;
  stoppedContainers: number;
  images: number;
  error: string | null;
}

export interface DockerContextSummary {
  name: string;
  description: string;
  dockerEndpoint: string;
  active: boolean;
  provider: string;
  providerLabel: string;
  canStartProvider: boolean;
}

export interface DockerContainerSummary {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  runningFor: string;
}

export interface DockerImageSummary {
  id: string;
  repository: string;
  tag: string;
  createdSince: string;
  size: string;
}

export interface DockerPortBinding {
  hostPort: string;
  containerPort: string;
  protocol?: string | null;
}

export interface DockerEnvVar {
  key: string;
  value: string;
}

export interface DockerRunRequest {
  image: string;
  name?: string | null;
  ports: DockerPortBinding[];
  environment: DockerEnvVar[];
  command?: string | null;
  restartPolicy?: string | null;
}

export interface DockerTerminalResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export async function getDockerOverview() {
  return invoke<DockerOverview>("docker_overview");
}

export async function listDockerContexts() {
  return invoke<DockerContextSummary[]>("docker_list_contexts");
}

export async function useDockerContext(contextName: string) {
  return invoke<string>("docker_use_context", { contextName });
}

export async function startDockerProvider(contextName?: string | null) {
  return invoke<string>("docker_start_provider", { contextName });
}

export async function listDockerContainers(all = true) {
  return invoke<DockerContainerSummary[]>("docker_list_containers", { all });
}

export async function listDockerImages() {
  return invoke<DockerImageSummary[]>("docker_list_images");
}

export async function dockerContainerAction(containerId: string, action: string) {
  return invoke<string>("docker_container_action", { containerId, action });
}

export async function dockerContainerLogs(containerId: string, tail = 200) {
  return invoke<string>("docker_container_logs", { containerId, tail });
}

export async function dockerContainerInspect(containerId: string) {
  return invoke<string>("docker_container_inspect", { containerId });
}

export async function dockerRunContainer(request: DockerRunRequest) {
  return invoke<string>("docker_run_container", { request });
}

export async function dockerTerminal(command: string) {
  return invoke<DockerTerminalResult>("docker_terminal", { command });
}
