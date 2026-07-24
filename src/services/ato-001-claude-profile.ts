export const ATO001_RUN_ID = "ato-001-pkr-004" as const;
export const ATO001_REPO_ID = "premium-komga-reader" as const;
export const ATO001_BRANCH = "master" as const;
export const ATO001_HEAD = "6036e56fb54ca332824fa9f26c48a82ae56110dd" as const;
export const ATO001_TASK_SHA256 = "65a9986da526db3c1c5900f5a7129b8dd6ce9e2cbda13aebd21aba223ed48b16" as const;
export const ATO001_CONTEXT_AGGREGATE_SHA256 = "b749c7e2edc96895cce837f6f80faec14abe05bb72cb33a7adeb29c76545b65e" as const;
export const ATO001_TIMEOUT_MS = 600_000;
export const ATO001_MAX_OUTPUT_BYTES = 262_144;

export const ATO001_CONTEXT = [
  ["AGENTS.md", "d0cc1ad61a9f6c4d8164c4cff34b4ba8e7197090dc16e58fbdf0aba794d1ff55"],
  ["PROJECT_STATE.md", "ce2f270f82da565bab1493b045c77e6a01becd23ef1cffc1c5c861950dff1e82"],
  ["DEVELOPMENT_BACKLOG.md", "65dabb5fda836d598616db51b5ea693126f46b93872f377bccb969fe58ecd0d2"],
  ["FEATURES.md", "95cbb1b9580c2226773074dde5f7dd05099e46aa5e9eba0559647b0044a26246"],
  ["premium-komga-reader-designspec.md", "b377f8f99b236c1f37f39ca76b6943ce6b35ef64d95a39b947e241d3c88475c2"],
  ["docs/premium-reference/wp-p0-baseline.md", "8effe266c43383a844bcf09e13a22cb0a00ea1ee7933c57b96ae26ef682491ff"],
  ["docs/premium-reference/wp-p1-parking-lot.md", "8e5cfde56df9efe7b7b19d626a83d371868932be691b0daab80d75e3bcfeece3"],
  ["app/src/main/java/com/premiumkomgareader/app/library/GlobalSearch.kt", "20913f3610ee8ea4c60ffbb354cf8345a9a72e47baee253b438b4bd8582ffd24"],
  ["app/src/main/java/com/premiumkomgareader/app/library/GlobalSearchScreen.kt", "00dc30deb523bac26dbdf94187c2dd0c78e1bcd1fb49ea0f9cb2ab89e883cb54"],
  ["app/src/main/java/com/premiumkomgareader/app/komga/KomgaGlobalSearchClient.kt", "7e0f5cd027ce4512d701b33f4eaebdd7787b769deb7762bd2958709bf88697ab"]
] as const;

export const ATO001_ARTIFACT_DIRECTORY = ".chatgpt/ato-001-claude-spike/ato-001-pkr-004";
export const ATO001_ARTIFACT_PATHS = {
  task: `${ATO001_ARTIFACT_DIRECTORY}/task.txt`,
  metadata: `${ATO001_ARTIFACT_DIRECTORY}/metadata.json`,
  state: `${ATO001_ARTIFACT_DIRECTORY}/execution.json`,
  output: `${ATO001_ARTIFACT_DIRECTORY}/provider-output.json`,
  result: `${ATO001_ARTIFACT_DIRECTORY}/validated-result.json`,
  measurements: `${ATO001_ARTIFACT_DIRECTORY}/measurements.json`,
  lease: ".chatgpt/ato-001-claude-spike/pkr-read-lease.json"
} as const;

export const ATO001_TASK_SOURCE_PATH = "src/fixed-tasks/ato-001-pkr-004.txt";

export const ATO001_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "framing_challenge",
    "recommended_product_contract",
    "recommended_ui_contract",
    "preservation_notes",
    "assumptions",
    "evidence_gaps",
    "owner_judgments",
    "exclusions_confirmed"
  ],
  properties: {
    framing_challenge: { type: "string", minLength: 1 },
    recommended_product_contract: { type: "string", minLength: 1 },
    recommended_ui_contract: { type: "string", minLength: 1 },
    preservation_notes: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    assumptions: { type: "array", items: { type: "string", minLength: 1 } },
    evidence_gaps: { type: "array", items: { type: "string", minLength: 1 } },
    owner_judgments: { type: "array", items: { type: "string", minLength: 1 } },
    exclusions_confirmed: {
      type: "object",
      additionalProperties: false,
      required: ["no_file_edits", "no_cross_source_deduplication", "no_production_implementation_plan"],
      properties: {
        no_file_edits: { const: true },
        no_cross_source_deduplication: { const: true },
        no_production_implementation_plan: { const: true }
      }
    }
  }
} as const;

export function ato001ContextIdentityText(): string {
  return ATO001_CONTEXT.map(([path, sha256]) => `${path}\0${sha256}\n`).join("");
}

export function ato001ArtifactPaths(): string[] {
  return Object.values(ATO001_ARTIFACT_PATHS);
}
