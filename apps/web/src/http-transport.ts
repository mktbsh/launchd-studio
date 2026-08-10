import type {
  ApplyOperation,
  ApplyResponse,
  ControlAction,
  ControlResponse,
  DoctorResponse,
  ExplainResponse,
  FormatResponse,
  LogsResponse,
  LogStream,
  ManifestSourceResponse,
  PlanResponse,
  RenderResponse,
  SaveManifestResponse,
  StatusResponse,
  StudioCapabilities,
  StudioTransport,
  ValidationResponse,
} from "@launchd-studio/core/transport";

interface ApiErrorEnvelope {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

export class HttpStudioTransport implements StudioTransport {
  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const envelope = payload as ApiErrorEnvelope | null;
      throw new Error(
        envelope?.error?.message ?? `Local API request failed with HTTP ${response.status}.`,
      );
    }
    return payload as T;
  }

  #post<T>(path: string, body: Readonly<Record<string, unknown>>): Promise<T> {
    return this.#request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  getCapabilities(): Promise<StudioCapabilities> {
    return this.#request("/api/capabilities");
  }

  loadManifest(): Promise<ManifestSourceResponse> {
    return this.#request("/api/manifest");
  }

  saveManifest(source: string): Promise<SaveManifestResponse> {
    return this.#request("/api/manifest", {
      method: "PUT",
      body: JSON.stringify({ source }),
    });
  }

  validateManifest(source: string): Promise<ValidationResponse> {
    return this.#post("/api/validate", { source });
  }

  formatManifest(source: string): Promise<FormatResponse> {
    return this.#post("/api/format", { source });
  }

  renderManifest(source: string, jobId?: string): Promise<RenderResponse> {
    return this.#post("/api/render", { source, ...(jobId === undefined ? {} : { jobId }) });
  }

  explainManifest(source: string, jobId?: string): Promise<ExplainResponse> {
    return this.#post("/api/explain", { source, ...(jobId === undefined ? {} : { jobId }) });
  }

  planManifest(source: string, jobId?: string): Promise<PlanResponse> {
    return this.#post("/api/plan", { source, ...(jobId === undefined ? {} : { jobId }) });
  }

  applyManifest(source: string, jobId?: string, start?: boolean): Promise<ApplyResponse> {
    return this.#post("/api/apply", {
      source,
      ...(jobId === undefined ? {} : { jobId }),
      ...(start === undefined ? {} : { start }),
    });
  }

  removeJob(
    source: string,
    jobId: string,
    keepPlist?: boolean,
  ): Promise<ReadonlyArray<ApplyOperation>> {
    return this.#post("/api/remove", {
      source,
      jobId,
      ...(keepPlist === undefined ? {} : { keepPlist }),
    });
  }

  getStatus(source: string, jobId?: string): Promise<StatusResponse> {
    return this.#post("/api/status", { source, ...(jobId === undefined ? {} : { jobId }) });
  }

  controlJob(source: string, jobId: string, action: ControlAction): Promise<ControlResponse> {
    return this.#post("/api/control", { source, jobId, action });
  }

  getLogs(
    source: string,
    jobId: string,
    stream: LogStream,
    tail: number,
  ): Promise<LogsResponse> {
    return this.#post("/api/logs", { source, jobId, stream, tail });
  }

  doctor(source: string, jobId?: string): Promise<DoctorResponse> {
    return this.#post("/api/doctor", { source, ...(jobId === undefined ? {} : { jobId }) });
  }
}
