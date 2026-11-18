/** Advisor transcripts are read-only artifacts, not interactive OMP sessions. */
export class OmpAdvisorSessionError extends Error {
  constructor(readonly filePath: string) {
    super(`OMP advisor transcripts cannot be imported or resumed: ${filePath}`);
    this.name = "OmpAdvisorSessionError";
  }
}

/** Matches upstream advisor/transcript-recorder.ts's reserved transcript filenames. */
export function isOmpAdvisorSessionFile(filePath: string): boolean {
  const name = filePath.slice(Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1);
  return name === "__advisor.jsonl" || (name.startsWith("__advisor.") && name.endsWith(".jsonl"));
}

export function assertOmpInteractiveSessionFile(filePath: string): void {
  if (isOmpAdvisorSessionFile(filePath)) {
    throw new OmpAdvisorSessionError(filePath);
  }
}
