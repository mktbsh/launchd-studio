import type {
  ActualJobState,
  JobPlan,
  ManifestPlan,
  PlanSummary,
  RenderedJob,
} from "../domain";

export function planLaunchdJob(
  desired: RenderedJob,
  actual: ActualJobState,
): JobPlan {
  const fileAction =
    actual.fileContent === null
      ? "create"
      : actual.fileContent === desired.plist
        ? "none"
        : "update";

  const runtimeAction =
    actual.runtime.loaded === null
      ? "unavailable"
      : actual.runtime.loaded
        ? fileAction === "none" && actual.runtimeDefinitionMatches === true
          ? "none"
          : "reload"
        : "load";

  return {
    id: desired.id,
    label: desired.label,
    plistPath: desired.plistPath,
    fileAction,
    runtimeAction,
    changed: fileAction !== "none" || runtimeAction !== "none",
    runtime: actual.runtime,
    runtimeDefinitionMatches: actual.runtimeDefinitionMatches,
  };
}

export function summarizePlan(jobs: ReadonlyArray<JobPlan>): PlanSummary {
  return jobs.reduce<PlanSummary>(
    (summary, job) => ({
      create: summary.create + (job.fileAction === "create" ? 1 : 0),
      update: summary.update + (job.fileAction === "update" ? 1 : 0),
      load: summary.load + (job.runtimeAction === "load" ? 1 : 0),
      reload: summary.reload + (job.runtimeAction === "reload" ? 1 : 0),
      unchanged: summary.unchanged + (!job.changed ? 1 : 0),
    }),
    { create: 0, update: 0, load: 0, reload: 0, unchanged: 0 },
  );
}

export function createManifestPlan(jobs: ReadonlyArray<JobPlan>): ManifestPlan {
  return {
    jobs,
    summary: summarizePlan(jobs),
  };
}
