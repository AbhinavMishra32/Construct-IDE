import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ConstructLearningStore } from "../constructLearningStore";
import { createConstructProtocolTools } from "../agent-tools/constructProtocolTools";
import type { StoredFlowProject } from "../projects/ConstructProjectTypes";
import { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";
import type { KnowledgeBaseRecord } from "../../shared/constructLearning";
import { ConstructConceptPolicyService } from "./ConstructConceptPolicyService";

describe("ConstructConceptPolicyService", () => {
  it("blocks C++ lambdas when the project only learned ordinary functions", async () => {
    const { store, project } = await projectHarness("cpp-project", "C++ Project");
    await teach(store, project, concept({
      id: "cpp.functions",
      title: "C++ functions",
      content: "A named function has parameters, a return type, and a body. Call it by name.",
      examples: ["int add(int a, int b) { return a + b; }"],
      masteryLevel: 3
    }));
    const policy = new ConstructConceptPolicyService({ learningStore: () => store });

    const decision = await policy.authorize({
      project,
      artifactKind: "task",
      artifactRef: "Transform values",
      declaredConceptIds: ["cpp.functions"],
      requireTaskReady: true,
      content: "Use auto twice = [](int value) { return value * 2; }; and call it for each input."
    });

    assert.equal(decision.allowed, false);
    assert.match(decision.blockedCapabilities.join("\n"), /lambda/i);
  });

  it("allows a lambda only after the project concept body explicitly teaches lambdas", async () => {
    const { store, project } = await projectHarness("cpp-project", "C++ Project");
    await teach(store, project, concept({
      id: "cpp.functions",
      title: "C++ functions and lambdas",
      content: "C++ lambda expressions are anonymous functions. Their syntax uses a capture list such as [] followed by parameters and a body.",
      examples: ["auto twice = [](int value) { return value * 2; };"],
      masteryLevel: 3
    }));
    const policy = new ConstructConceptPolicyService({ learningStore: () => store });

    const decision = await policy.authorize({
      project,
      artifactKind: "task",
      artifactRef: "Transform values",
      declaredConceptIds: ["cpp.functions"],
      requireTaskReady: true,
      content: "Use auto twice = [](int value) { return value * 2; }; and call it for each input."
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.matchedConceptIds, ["cpp.functions"]);
  });

  it("does not allow a concept taught in another project", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-concept-policy-"));
    const store = new ConstructLearningStore(path.join(dir, "learning-state.json"));
    const first = flowProject("first", "First Project");
    const second = flowProject("second", "Second Project");
    await teach(store, first, concept({
      id: "cpp.functions",
      title: "C++ functions",
      content: "Named functions have parameters and return values.",
      masteryLevel: 3
    }));
    const policy = new ConstructConceptPolicyService({ learningStore: () => store });

    const decision = await policy.authorize({
      project: second,
      artifactKind: "task",
      artifactRef: "Write a function",
      declaredConceptIds: ["cpp.functions"],
      requireTaskReady: true,
      content: "Write int add(int a, int b) and return the sum."
    });

    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /other project|do not count/i);
  });

  it("records project lists and artifact usage for each concept", async () => {
    const { store, project } = await projectHarness("cpp-project", "C++ Project");
    await teach(store, project, concept({
      id: "cpp.variables",
      title: "C++ variables",
      content: "A variable has a type, a name, and a value.",
      masteryLevel: 3
    }));
    const policy = new ConstructConceptPolicyService({ learningStore: () => store });

    const decision = await policy.authorize({
      project,
      artifactKind: "file-write",
      artifactRef: "src/main.cpp",
      declaredConceptIds: ["cpp.variables"],
      content: "int count = 0;"
    });

    assert.equal(decision.allowed, true);
    const state = await store.getState();
    const relation = state.projects[project.id].conceptRelations?.["cpp.variables"];
    assert.equal(relation?.projectId, project.id);
    assert.equal(relation?.lastEventKind, "write-used");
    assert.equal(state.projects[project.id].artifactAudits?.at(-1)?.status, "allowed");
    const saved = Object.values(state.knowledgeBase.concepts).find((record) => record.id === "cpp.variables");
    assert.equal(saved?.projects?.[0]?.projectId, project.id);
  });

  it("blocks a real write before bytes reach disk when content exceeds project concepts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-concept-write-"));
    const store = new ConstructLearningStore(path.join(dir, "learning-state.json"));
    const project = flowProject("cpp-write", "C++ Write");
    project.workspacePath = path.join(dir, "workspace");
    await mkdir(project.workspacePath, { recursive: true });
    await teach(store, project, concept({
      id: "cpp.functions",
      title: "C++ functions",
      content: "Named functions use parameters and a return value.",
      masteryLevel: 3
    }));
    const policy = new ConstructConceptPolicyService({ learningStore: () => store });
    const workspace = new ConstructProjectWorkspaceService(() => dir, () => dir);
    const protocol = createConstructProtocolTools({
      project,
      workspace,
      allowWorkspaceMutation: true,
      authorizeWorkspaceMutation: async (mutation) => {
        const decision = await policy.authorize({
          project,
          artifactKind: mutation.kind,
          artifactRef: mutation.path,
          content: mutation.content,
          declaredConceptIds: mutation.conceptIds
        });
        if (!decision.allowed) throw new Error(decision.reason);
      }
    });

    await assert.rejects(
      () => (protocol.tools.write as any).execute({
        path: "main.cpp",
        content: "auto twice = [](int value) { return value * 2; };",
        reason: "Prepare learner scaffold.",
        conceptIds: ["cpp.functions"]
      }),
      /uncovered|audit|concept/i
    );
    assert.equal(existsSync(path.join(project.workspacePath, "main.cpp")), false);
  });

  it("uses project-local learner memory as prior evidence for prerequisite fluency", async () => {
    const { store, project } = await projectHarness("js-project", "JavaScript Project");
    await teach(store, project, concept({
      id: "js.variables",
      title: "JavaScript variables",
      content: "A variable stores a named value that code can read later.",
      masteryLevel: 3
    }));
    const policy = new ConstructConceptPolicyService({
      learningStore: () => store,
      readProjectMemory: async () => [{
        file: "learner.md",
        content: [
          "# Learner",
          "",
          "Known concepts: JavaScript arrow functions — comfortable.",
          "",
          "Weak concepts: none recorded yet."
        ].join("\n")
      }]
    });

    const decision = await policy.authorize({
      project,
      artifactKind: "task",
      artifactRef: "Use a tiny callback",
      declaredConceptIds: ["js.variables"],
      requireTaskReady: true,
      content: "Read const double = (value) => value * 2; and explain what value stores."
    });

    assert.equal(decision.allowed, true);
  });

  it("uses learner.md heading and bullet sections as prior evidence", async () => {
    const { store, project } = await projectHarness("js-project", "JavaScript Project");
    await teach(store, project, concept({
      id: "js.variables",
      title: "JavaScript variables",
      content: "A variable stores a named value that code can read later.",
      masteryLevel: 3
    }));
    const policy = new ConstructConceptPolicyService({
      learningStore: () => store,
      readProjectMemory: async () => [{
        file: ".construct/learner.md",
        content: [
          "# Learner",
          "",
          "## Known concepts",
          "",
          "- JavaScript arrow functions — comfortable from earlier project work.",
          "",
          "## Recent learning evidence",
          "",
          "- The learner explained callback input and return value flow in their own words."
        ].join("\n")
      }]
    });

    const decision = await policy.authorize({
      project,
      artifactKind: "task",
      artifactRef: "Use a tiny callback",
      declaredConceptIds: ["js.variables"],
      requireTaskReady: true,
      content: "Read const double = (value) => value * 2; and explain what value stores."
    });

    assert.equal(decision.allowed, true);
  });

  it("does not use learner memory to cover capabilities recorded as weak", async () => {
    const { store, project } = await projectHarness("js-project", "JavaScript Project");
    await teach(store, project, concept({
      id: "js.variables",
      title: "JavaScript variables",
      content: "A variable stores a named value that code can read later.",
      masteryLevel: 3
    }));
    const policy = new ConstructConceptPolicyService({
      learningStore: () => store,
      readProjectMemory: async () => [{
        file: "learner.md",
        content: [
          "# Learner",
          "",
          "Known concepts: JavaScript arrow functions — comfortable.",
          "",
          "Weak concepts: JavaScript arrow functions."
        ].join("\n")
      }]
    });

    const decision = await policy.authorize({
      project,
      artifactKind: "task",
      artifactRef: "Use a tiny callback",
      declaredConceptIds: ["js.variables"],
      requireTaskReady: true,
      content: "Read const double = (value) => value * 2; and explain what value stores."
    });

    assert.equal(decision.allowed, false);
    assert.match(decision.blockedCapabilities.join("\n"), /arrow function/i);
  });

  it("lets the semantic audit reason from learner prior evidence without promoting weak targets", async () => {
    const { store, project } = await projectHarness("next16-project", "Next.js 16 Project");
    await teach(store, project, concept({
      id: "next16.project-structure",
      title: "Next.js 16 project structure",
      content: "Next.js 16 scaffolds a project that uses Turbopack by default.",
      masteryLevel: 3
    }));
    let prompt = "";
    const policy = new ConstructConceptPolicyService({
      learningStore: () => store,
      readProjectMemory: async () => [{
        file: "learner.md",
        content: [
          "# Learner",
          "",
          "Known concepts: Next.js App Router (v14/v15), Server Components, Server Actions — comfortable.",
          "",
          "Weak concepts: Next.js 16-specific features (Turbopack config, Cache Components/\"use cache\", proxy.ts, React 19.2 additions).",
          "",
          "Recent learning evidence: Self-reported App Router v14/v15 comfort."
        ].join("\n")
      }],
      agentRuntime: () => ({
        generateStructured: async (request: any) => {
          prompt = request.prompt;
          return {
            capabilities: [{
              name: "App Router project navigation",
              evidence: "open the scaffolded app and inspect the layout",
              matchedConceptIds: [],
              matchedPriorEvidenceIds: ["learner.md:known-concepts"]
            }],
            uncoveredCapabilities: [],
            summary: "Prerequisite App Router fluency is covered by project-local learner prior evidence."
          };
        }
      } as any)
    });

    const decision = await policy.authorize({
      project,
      artifactKind: "task",
      artifactRef: "Explore scaffold",
      declaredConceptIds: ["next16.project-structure"],
      requireTaskReady: true,
      content: "Open the local app in a browser, inspect app/layout.tsx, and compare the scaffold with your App Router v14/v15 experience."
    });

    assert.equal(decision.allowed, true);
    assert.match(prompt, /Project-local learner prior evidence/i);
    assert.match(prompt, /App Router \(v14\/v15\)/);
    assert.match(prompt, /Project-local weak or needs-learning evidence/i);
    assert.match(prompt, /Cache Components/);
  });

  it("allows covered artifacts when the semantic model returns empty structured output", async () => {
    const { store, project } = await projectHarness("cpp-parser", "C++ Parser");
    await teach(store, project, concept({
      id: "cpp.parser-foundations",
      title: "C++ parser foundations",
      content: "A C++ enum class names scoped variants such as TokenType::StartTag. A struct groups fields such as type and name. A std::string variable can copy a tag name.",
      examples: [
        "enum class TokenType { StartTag, EndTag, Text };",
        "Token t; t.type = TokenType::StartTag; t.name = tagName;"
      ],
      masteryLevel: 2
    }));
    const policy = new ConstructConceptPolicyService({
      learningStore: () => store,
      agentRuntime: () => ({
        generateStructured: async () => {
          throw new Error("Model returned empty structured output. Model: deepseek-v4-flash-free, Provider: opencode-zen.");
        }
      } as any)
    });

    const decision = await policy.authorize({
      project,
      artifactKind: "assessment",
      artifactRef: "C++ warmup: token struct",
      declaredConceptIds: ["cpp.parser-foundations"],
      content: JSON.stringify({
        title: "C++ warmup: token struct",
        prompt: [
          "Look at this C++ snippet. Fill in the blank so that t.name is \"div\" and t.type is TokenType::StartTag:",
          "enum class TokenType { StartTag, EndTag, Text };",
          "struct Token { TokenType type; std::string name; };",
          "Token makeStartTag(const std::string& tagName) { Token t; t.type = _____; t.name = _____; return t; }"
        ].join("\n"),
        successCriteria: [
          "Correctly fills type as TokenType::StartTag",
          "Correctly fills name as tagName"
        ]
      }, null, 2)
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.blockedCapabilities, []);
    assert.match(decision.reason, /Semantic concept audit unavailable/i);
    assert.doesNotMatch(decision.reason, /failed closed/i);
    const state = await store.getState();
    assert.equal(state.projects[project.id].artifactAudits?.at(-1)?.status, "allowed");
  });

  it("still blocks deterministic uncovered capabilities when the semantic model is unavailable", async () => {
    const { store, project } = await projectHarness("cpp-project", "C++ Project");
    await teach(store, project, concept({
      id: "cpp.functions",
      title: "C++ functions",
      content: "A named function has parameters, a return type, and a body. Call it by name.",
      examples: ["int add(int a, int b) { return a + b; }"],
      masteryLevel: 3
    }));
    const policy = new ConstructConceptPolicyService({
      learningStore: () => store,
      agentRuntime: () => ({
        generateStructured: async () => {
          throw new Error("Model returned empty structured output.");
        }
      } as any)
    });

    const decision = await policy.authorize({
      project,
      artifactKind: "task",
      artifactRef: "Transform values",
      declaredConceptIds: ["cpp.functions"],
      requireTaskReady: true,
      content: "Use auto twice = [](int value) { return value * 2; }; and call it for each input."
    });

    assert.equal(decision.allowed, false);
    assert.match(decision.blockedCapabilities.join("\n"), /lambda/i);
    assert.doesNotMatch(decision.blockedCapabilities.join("\n"), /semantic concept audit/i);
    assert.match(decision.reason, /Semantic concept audit unavailable/i);
  });

  it("allows everything without restrictions if the firewall is disabled in settings", async () => {
    const { store, project } = await projectHarness("cpp-project", "C++ Project");
    const policy = new ConstructConceptPolicyService({
      learningStore: () => store,
      readSettings: async () => ({
        workspaceRoot: "",
        releaseVersion: "",
        app: { showStatusBar: true },
        ai: {
          runtime: "mastra",
          source: "byok",
          provider: "openai",
          reasoningEffort: "auto",
          openAiApiKey: "",
          openAiModel: "",
          openAiBaseUrl: "",
          openRouterApiKey: "",
          openRouterModel: "",
          openRouterBaseUrl: "",
          liteLlmApiKey: "",
          liteLlmModel: "",
          liteLlmBaseUrl: "",
          liteLlmManageServer: false,
          opencodeZenApiKey: "",
          opencodeZenBaseUrl: "",
          opencodeZenModel: "",
          githubCopilotModel: "",
          constructCloudBaseUrl: "",
          constructCloudAccessToken: "",
          constructCloudModel: "",
          tavilyApiKey: "",
          featureModels: {},
          codeGhostEnabled: true,
          conceptFirewallEnabled: false,
          flowSourceGroundingEnabled: true
        },
        observability: {
          enabled: false,
          phoenixEndpoint: "",
          phoenixApiKey: "",
          phoenixProjectName: "",
          batch: true
        }
      })
    });

    const decision = await policy.authorize({
      project,
      artifactKind: "task",
      artifactRef: "Transform values",
      declaredConceptIds: ["cpp.functions"],
      requireTaskReady: true,
      content: "Use auto twice = [](int value) { return value * 2; }; and call it for each input."
    });

    assert.equal(decision.allowed, true);
  });
});

async function projectHarness(id: string, title: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "construct-concept-policy-"));
  const project = flowProject(id, title);
  project.workspacePath = path.join(dir, id);
  return {
    store: new ConstructLearningStore(path.join(dir, "learning-state.json")),
    project
  };
}

async function teach(store: ConstructLearningStore, project: StoredFlowProject, record: KnowledgeBaseRecord) {
  await store.saveKnowledgeConcept({
    ...record,
    sourceProjectId: project.id,
    sourceProjectTitle: project.title
  });
  await store.recordConceptProjectEvent({
    id: `${project.id}:${record.id}:introduced`,
    projectId: project.id,
    projectTitle: project.title,
    conceptId: record.id,
    kind: "introduced",
    masteryLevel: record.masteryLevel ?? 0,
    reason: "Taught in test.",
    evidence: [record.content ?? record.summary],
    artifactKind: "teaching",
    createdAt: record.savedAt
  });
}

function concept(input: {
  id: string;
  title: string;
  content: string;
  examples?: string[];
  masteryLevel: 0 | 1 | 2 | 3 | 4 | 5;
}): KnowledgeBaseRecord {
  const now = new Date().toISOString();
  return {
    id: input.id,
    sourceProjectId: "",
    sourceProjectTitle: "",
    title: input.title,
    kind: "concept",
    language: "cpp",
    tags: [],
    summary: input.content,
    why: "",
    docs: [],
    content: input.content,
    examples: input.examples ?? [],
    confidence: "applying",
    masteryLevel: input.masteryLevel,
    savedAt: now,
    openCount: 0,
    usedInRecall: false,
    lastModifiedAt: now
  };
}

function flowProject(id: string, title: string): StoredFlowProject {
  const now = new Date().toISOString();
  return {
    kind: "flow",
    id,
    title,
    description: title,
    progress: 0,
    lastOpenedAt: now,
    workspacePath: path.join(tmpdir(), id),
    sourcePath: null,
    activeFilePath: null,
    fileTreeExpanded: [],
    completedAt: null,
    flow: {
      goal: `Learn through ${title}`,
      memoryDirectory: ".construct",
      threadId: `${id}-thread`,
      researchEnabled: false,
      sessions: [],
      createdAt: now,
      updatedAt: now
    }
  };
}
