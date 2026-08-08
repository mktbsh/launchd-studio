export const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
export const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
export const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function deriveLabel(jobId: string): string {
  return jobId.includes(".") ? jobId : `dev.launchd-studio.${jobId}`;
}

export function isAbsoluteOrHomePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("~/");
}
