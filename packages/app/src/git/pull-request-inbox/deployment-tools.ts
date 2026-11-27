interface DeploymentComment {
  author: string | null;
  body: string;
  url: string;
  createdAt: string;
  kind: "comment" | "review";
  headSha: string | null;
  path: string | null;
}

interface DeploymentCheck {
  name: string;
  state: string;
  url: string | null;
}

const ATLANTIS_AUTHOR = "grafanabot-atlantis[bot]";
const LEGACY_EXPORTER_AUTHOR = "grafanabot";
const EXPORTER_AUTHOR = "kube-manifests-exporter[bot]";

type AtlantisReportStatus =
  | "automergeFailed"
  | "applied"
  | "stale"
  | "locked"
  | "policyFailed"
  | "applyFailed"
  | "planFailed"
  | "applyReported"
  | "planReported"
  | "report";

function identifyAtlantisReport(body: string): AtlantisReportStatus {
  if (/^Automerging failed:/im.test(body)) return "automergeFailed";
  if (/Automatically merging because all plans have been successfully applied/i.test(body)) {
    return "applied";
  }
  if (/saved plan is stale/i.test(body)) return "stale";
  if (/locked by (?:another|pull request|PR\b)/i.test(body)) return "locked";
  if (/policy check (?:failed|failure)/i.test(body)) return "policyFailed";
  if (/\b(?:Apply Error|Apply Failed)\b/i.test(body)) return "applyFailed";
  if (/\b(?:Plan Error|Plan Failed)\b/i.test(body)) return "planFailed";
  if (/\bApply complete\b/i.test(body)) return "applyReported";
  if (/\b(?:Ran Plan for|Plan: \d+ to add|No changes\. Your infrastructure)\b/i.test(body)) {
    return "planReported";
  }
  return "report";
}

function parseManifestEnvironments(body: string) {
  const environments = new Set<string>();
  for (const section of body.matchAll(
    /<summary>Changes to manifests (?:in (?:dev|ops|prod) clusters|not managed by Flux)[^<]*(?:<b>[^<]*<\/b>[^<]*)?<\/summary>([\s\S]*?)<\/details>/g,
  )) {
    for (const row of section[1].matchAll(
      /^\s*- `([^`\n]+)` \(\d+ added, \d+ deleted, \d+ modified\)/gm,
    )) {
      environments.add(row[1]);
    }
  }
  return [...environments];
}

export interface DeploymentToolsReports {
  atlantis?: { evidence: DeploymentComment; status: AtlantisReportStatus };
  kubernetes?: { evidence: DeploymentComment; environments: string[] };
  policy?: DeploymentCheck;
}

/** Classifies source-linked reports, never the current deploy/merge state. */
export function getDeploymentToolsReports(
  repository: string,
  headSha: string,
  activity: readonly DeploymentComment[],
  checks: readonly DeploymentCheck[],
): DeploymentToolsReports | null {
  if (repository.toLowerCase() !== "grafana/deployment_tools") return null;

  let atlantis: DeploymentComment | undefined;
  let kubernetes: DeploymentComment | undefined;
  for (const item of activity) {
    if (item.kind !== "comment" || item.path !== null) continue;
    // A comment without a revision is a bot report, not proof that the current SHA is ready.
    if (item.headSha !== null && item.headSha !== headSha) continue;
    if (item.author === ATLANTIS_AUTHOR && (!atlantis || item.createdAt > atlantis.createdAt)) {
      atlantis = item;
    }
    if (
      (item.author === EXPORTER_AUTHOR || item.author === LEGACY_EXPORTER_AUTHOR) &&
      /\bkube-manifests\b/i.test(item.body) &&
      (!kubernetes || item.createdAt > kubernetes.createdAt)
    ) {
      kubernetes = item;
    }
  }

  const policy = checks.find(({ name }) => /^policy[ -]bot(?:\s*[:/-].*)?$/i.test(name));
  if (!atlantis && !kubernetes && !policy) return null;
  return {
    atlantis: atlantis && { evidence: atlantis, status: identifyAtlantisReport(atlantis.body) },
    kubernetes: kubernetes && {
      evidence: kubernetes,
      environments: parseManifestEnvironments(kubernetes.body),
    },
    policy,
  };
}
