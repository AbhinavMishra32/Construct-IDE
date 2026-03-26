import { spawn } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import {
  BlueprintTaskRequestSchema,
  ProjectBlueprintSchema,
  TaskExecutionRequestSchema,
  TaskResultSchema,
  getBlueprintRuntimeSteps,
  type BlueprintTaskRequest,
  type ProjectBlueprint,
  type TaskExecutionRequest,
  type TaskFailure,
  type TaskResult,
  type TestAdapterKind
} from "@construct/shared";

const DEFAULT_TIMEOUT_MS = 30_000;
const JEST_CONFIG_CANDIDATES = [
  "jest.config.cjs",
  "jest.config.js",
  "jest.config.mjs",
  "jest.config.ts",
  "jest.config.json"
];

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultBlueprintPath = path.join(
  rootDir,
  "blueprints",
  "workflow-runtime",
  "project-blueprint.json"
);

interface TestAdapter {
  readonly kind: TestAdapterKind;
  run(request: TaskExecutionRequest): Promise<TaskResult>;
}

interface JestJsonAssertionResult {
  ancestorTitles?: string[];
  failureMessages?: string[];
  fullName?: string;
  status?: string;
  title?: string;
}

interface JestJsonTestResult {
  assertionResults?: JestJsonAssertionResult[];
  message?: string;
  name: string;
  status?: string;
}

interface JestJsonOutput {
  numFailedTests?: number;
  testResults?: JestJsonTestResult[];
}

interface ProcessExecutionResult {
  durationMs: number;
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

export class BlueprintResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlueprintResolutionError";
  }
}

export class UnsupportedAdapterError extends Error {
  constructor(adapter: string) {
    super(`No test adapter is registered for ${adapter}.`);
    this.name = "UnsupportedAdapterError";
  }
}

export class JestTestAdapter implements TestAdapter {
  readonly kind = "jest" as const;

  async run(request: TaskExecutionRequest): Promise<TaskResult> {
    const normalizedRequest = normalizeTaskExecutionRequest(request);
    const testsRun = normalizedRequest.tests.map((testPath) =>
      path.relative(normalizedRequest.projectRoot, testPath) || path.basename(testPath)
    );

    if (shouldRunNodeValidationScripts(normalizedRequest.tests)) {
      return runNodeValidationScripts(normalizedRequest, this.kind, testsRun);
    }

    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "construct-jest-results-"));
    const outputFile = path.join(outputDirectory, "results.json");
    const jestBinaryPath = findUpwardJestBinaryPath(normalizedRequest.projectRoot);
    const jestConfigPath = findFirstUpwardExistingPath(
      normalizedRequest.projectRoot,
      JEST_CONFIG_CANDIDATES
    );

    if (!jestBinaryPath) {
      throw new BlueprintResolutionError(
        `Unable to locate a Jest binary from ${normalizedRequest.projectRoot}.`
      );
    }

    const jestArguments = [jestBinaryPath];

    if (jestConfigPath) {
      jestArguments.push("--config", jestConfigPath);
    }

    jestArguments.push(
      "--runInBand",
      "--json",
      "--outputFile",
      outputFile,
      "--runTestsByPath",
      ...normalizedRequest.tests
    );

    const startedAt = Date.now();
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;

    try {
      const child = spawn(process.execPath, jestArguments, {
        cwd: normalizedRequest.projectRoot,
        env: {
          ...process.env,
          CI: "1"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      exitCode = await new Promise<number | null>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
        }, normalizedRequest.timeoutMs);

        timeoutHandle.unref();

        child.once("error", (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        });

        child.once("close", (code) => {
          clearTimeout(timeoutHandle);
          resolve(code);
        });
      });

      const failures = await this.collectFailures(
        outputFile,
        normalizedRequest,
        stderr,
        timedOut,
        exitCode
      );
      const status = !timedOut && exitCode === 0 ? "passed" : "failed";

      return TaskResultSchema.parse({
        stepId: normalizedRequest.stepId,
        adapter: this.kind,
        status,
        durationMs: Date.now() - startedAt,
        testsRun,
        failures,
        exitCode,
        timedOut,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  }

  private async collectFailures(
    outputFile: string,
    request: TaskExecutionRequest,
    stderr: string,
    timedOut: boolean,
    exitCode: number | null
  ): Promise<TaskFailure[]> {
    const jsonOutput = await readJestJsonOutput(outputFile);
    const failures: TaskFailure[] = [];

    for (const testResult of jsonOutput?.testResults ?? []) {
      const assertionFailures =
        testResult.assertionResults?.filter((assertion) => assertion.status === "failed") ?? [];

      if (assertionFailures.length > 0) {
        for (const assertionFailure of assertionFailures) {
          const stackTrace = assertionFailure.failureMessages?.join("\n").trim();
          const comparison = extractOutputComparison(
            stackTrace ?? testResult.message ?? "The Jest assertion failed."
          );
          failures.push({
            testName:
              assertionFailure.fullName ??
              assertionFailure.title ??
              path.basename(testResult.name),
            message: summarizeFailureMessage(
              stackTrace ?? testResult.message ?? "The Jest assertion failed."
            ),
            ...comparison,
            stackTrace
          });
        }

        continue;
      }

      if (testResult.status === "failed" && testResult.message) {
        const comparison = extractOutputComparison(testResult.message);
        failures.push({
          testName: path.basename(testResult.name),
          message: summarizeFailureMessage(testResult.message),
          ...comparison,
          stackTrace: testResult.message.trim()
        });
      }
    }

    if (failures.length > 0) {
      return failures;
    }

    if (timedOut) {
      return [
        {
          testName: request.stepId,
          message: `The Jest process timed out after ${request.timeoutMs}ms.`,
          stackTrace: stderr.trim() || undefined
        }
      ];
    }

    if (exitCode !== 0 && stderr.trim()) {
      return [
        {
          testName: request.stepId,
          message: summarizeFailureMessage(stderr),
          stackTrace: stderr.trim()
        }
      ];
    }

    return [];
  }
}

export class PytestTestAdapter implements TestAdapter {
  readonly kind = "pytest" as const;

  async run(request: TaskExecutionRequest): Promise<TaskResult> {
    const normalizedRequest = normalizeTaskExecutionRequest(request);
    const testsRun = normalizedRequest.tests.map((testPath) =>
      path.relative(normalizedRequest.projectRoot, testPath) || path.basename(testPath)
    );

    const { result } = await runPytestCommand(normalizedRequest);
    const failures = collectPytestFailures(normalizedRequest, result);
    const status = !result.timedOut && result.exitCode === 0 ? "passed" : "failed";

    return TaskResultSchema.parse({
      stepId: normalizedRequest.stepId,
      adapter: this.kind,
      status,
      durationMs: result.durationMs,
      testsRun,
      failures,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    });
  }
}

export class CargoTestAdapter implements TestAdapter {
  readonly kind = "cargo" as const;

  async run(request: TaskExecutionRequest): Promise<TaskResult> {
    const normalizedRequest = normalizeTaskExecutionRequest(request);
    const testsRun = normalizedRequest.tests.map((testPath) =>
      path.relative(normalizedRequest.projectRoot, testPath) || path.basename(testPath)
    );
    const cargoTestArgs = buildCargoTestArgs(normalizedRequest);
    let result: ProcessExecutionResult;

    try {
      result = await runProcess("cargo", cargoTestArgs, {
        cwd: normalizedRequest.projectRoot,
        timeoutMs: normalizedRequest.timeoutMs,
        env: {
          CARGO_TERM_COLOR: "never",
          CI: "1"
        }
      });
    } catch (error) {
      if (isMissingBinaryError(error)) {
        throw new BlueprintResolutionError(
          "Unable to locate Cargo in PATH for this Rust project."
        );
      }

      throw error;
    }

    const failures = collectCargoFailures(normalizedRequest, result);
    const status = !result.timedOut && result.exitCode === 0 ? "passed" : "failed";

    return TaskResultSchema.parse({
      stepId: normalizedRequest.stepId,
      adapter: this.kind,
      status,
      durationMs: result.durationMs,
      testsRun,
      failures,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    });
  }
}

export class TestRunnerManager {
  private readonly adapters: Map<TestAdapterKind, TestAdapter>;

  constructor(
    adapters: TestAdapter[] = [
      new JestTestAdapter(),
      new PytestTestAdapter(),
      new CargoTestAdapter()
    ]
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.kind, adapter]));
  }

  async runTask(request: TaskExecutionRequest): Promise<TaskResult> {
    const normalizedRequest = normalizeTaskExecutionRequest(request);
    const adapter = this.adapters.get(normalizedRequest.adapter);

    if (!adapter) {
      throw new UnsupportedAdapterError(normalizedRequest.adapter);
    }

    return adapter.run(normalizedRequest);
  }

  async runBlueprintStep(request: BlueprintTaskRequest): Promise<TaskResult> {
    const executionRequest = await resolveBlueprintStepRequest(request);
    return this.runTask(executionRequest);
  }

  async runBlueprintSuite(options?: {
    blueprintPath?: string;
    timeoutMs?: number;
  }): Promise<TaskResult> {
    const blueprintPath = path.resolve(options?.blueprintPath ?? defaultBlueprintPath);
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const blueprint = await loadBlueprint(blueprintPath);
    const tests = await discoverBlueprintSuiteTests(path.dirname(blueprintPath), blueprint);

    return this.runTask({
      stepId: "blueprint.all",
      adapter: inferAdapterFromBlueprint(blueprint),
      projectRoot: path.dirname(blueprintPath),
      tests,
      timeoutMs
    });
  }
}

export async function resolveBlueprintStepRequest(
  request: BlueprintTaskRequest
): Promise<TaskExecutionRequest> {
  const parsedRequest = BlueprintTaskRequestSchema.parse({
    ...request,
    blueprintPath: path.resolve(request.blueprintPath)
  });
  const blueprint = await loadBlueprint(parsedRequest.blueprintPath);
  const step = getBlueprintRuntimeSteps(blueprint).find(
    (candidate) => candidate.id === parsedRequest.stepId
  );

  if (!step) {
    throw new BlueprintResolutionError(
      `Step ${parsedRequest.stepId} was not found in blueprint ${blueprint.id}.`
    );
  }

  return TaskExecutionRequestSchema.parse({
    stepId: step.id,
    adapter: inferAdapterFromBlueprint(blueprint),
    projectRoot: path.dirname(parsedRequest.blueprintPath),
    tests: step.tests,
    timeoutMs: parsedRequest.timeoutMs
  });
}

export async function loadBlueprint(blueprintPath: string): Promise<ProjectBlueprint> {
  const rawBlueprint = await readFile(blueprintPath, "utf8");
  return ProjectBlueprintSchema.parse(JSON.parse(rawBlueprint));
}

export function inferAdapterFromBlueprint(blueprint: ProjectBlueprint): TestAdapterKind {
  switch (normalizeBlueprintLanguage(blueprint.language)) {
    case "javascript":
    case "js":
    case "jsx":
    case "typescript":
    case "ts":
    case "tsx":
      return "jest";
    case "python":
    case "py":
      return "pytest";
    case "rust":
    case "rs":
      return "cargo";
    default:
      throw new BlueprintResolutionError(
        `No adapter mapping exists yet for blueprint language ${blueprint.language}. Supported languages currently map to jest (JavaScript/TypeScript), pytest (Python), or cargo (Rust).`
      );
  }
}

function normalizeTaskExecutionRequest(request: TaskExecutionRequest): TaskExecutionRequest {
  const parsedRequest = TaskExecutionRequestSchema.parse(request);
  const projectRoot = resolveToRealPath(parsedRequest.projectRoot);

  return {
    ...parsedRequest,
    projectRoot,
    tests: parsedRequest.tests.map((testPath) =>
      resolveToRealPath(path.resolve(projectRoot, testPath))
    )
  };
}

async function readJestJsonOutput(outputFile: string): Promise<JestJsonOutput | null> {
  if (!existsSync(outputFile)) {
    return null;
  }

  const rawOutput = await readFile(outputFile, "utf8");
  return JSON.parse(rawOutput) as JestJsonOutput;
}

async function discoverBlueprintSuiteTests(
  projectRoot: string,
  blueprint: ProjectBlueprint
): Promise<string[]> {
  const testsDirectory = path.join(projectRoot, "tests");

  if (!existsSync(testsDirectory)) {
    return Array.from(new Set(blueprint.steps.flatMap((step) => step.tests)));
  }

  const discoveredFiles: string[] = [];
  await walkDirectory(testsDirectory, async (filePath) => {
    discoveredFiles.push(path.relative(projectRoot, filePath));
  });

  discoveredFiles.sort((left, right) => left.localeCompare(right));
  return discoveredFiles;
}

function summarizeFailureMessage(message: string): string {
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines[0] ?? "Test execution failed.";
}

function extractOutputComparison(message: string): Pick<
  TaskFailure,
  "expectedOutput" | "actualOutput"
> {
  const normalized = message.replace(/\r\n/g, "\n");
  const jestComparison = {
    expectedOutput: extractLabeledOutput(normalized, "Expected:"),
    actualOutput: extractLabeledOutput(normalized, "Received:")
  };

  if (jestComparison.expectedOutput || jestComparison.actualOutput) {
    return jestComparison;
  }

  const cargoComparison = {
    expectedOutput: extractLabeledOutput(normalized, "right:"),
    actualOutput: extractLabeledOutput(normalized, "left:")
  };

  if (cargoComparison.expectedOutput || cargoComparison.actualOutput) {
    return cargoComparison;
  }

  const pytestLine = normalized
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^E\s+assert\s+.+\s==\s.+$/.test(line));

  if (!pytestLine) {
    return {};
  }

  const pytestMatch = /^E\s+assert\s+(.+?)\s*==\s*(.+)$/.exec(pytestLine);

  if (!pytestMatch) {
    return {};
  }

  return {
    actualOutput: pytestMatch[1].trim(),
    expectedOutput: pytestMatch[2].trim()
  };
}

function extractLabeledOutput(message: string, label: string): string | undefined {
  const lines = message.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const labelIndex = line.indexOf(label);

    if (labelIndex === -1) {
      continue;
    }

    const inlineValue = line.slice(labelIndex + label.length).trim();

    if (inlineValue) {
      return inlineValue;
    }

    const collected: string[] = [];

    for (let offset = index + 1; offset < lines.length; offset += 1) {
      const candidate = lines[offset] ?? "";
      const trimmedCandidate = candidate.trim();

      if (!trimmedCandidate) {
        if (collected.length > 0) {
          break;
        }

        continue;
      }

      if (/^(Expected:|Received:|left:|right:)/.test(trimmedCandidate)) {
        break;
      }

      collected.push(candidate.replace(/^\s+/, ""));
    }

    if (collected.length > 0) {
      return collected.join("\n").trim();
    }
  }

  return undefined;
}

function normalizeBlueprintLanguage(language: string): string {
  return language.trim().toLowerCase();
}

function shouldRunNodeValidationScripts(tests: string[]): boolean {
  return (
    tests.length > 0 &&
    tests.every((testPath) => {
      const normalized = testPath.replace(/\\/g, "/");
      return normalized.includes("/hidden_tests/") && normalized.endsWith(".js");
    })
  );
}

async function runNodeValidationScripts(
  request: TaskExecutionRequest,
  adapter: TestAdapterKind,
  testsRun: string[]
): Promise<TaskResult> {
  const startedAt = Date.now();
  const failures: TaskFailure[] = [];
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let timedOut = false;
  let exitCode = 0;

  for (const testPath of request.tests) {
    const result = await runNodeValidationScript(testPath, request.projectRoot, request.timeoutMs);

    if (result.stdout.trim()) {
      stdoutChunks.push(result.stdout.trim());
    }

    if (result.stderr.trim()) {
      stderrChunks.push(result.stderr.trim());
    }

    failures.push(...collectNodeValidationFailures(request, testPath, result));

    if (result.timedOut) {
      timedOut = true;
      exitCode = result.exitCode ?? 1;
      break;
    }

    if ((result.exitCode ?? 0) !== 0) {
      exitCode = result.exitCode ?? 1;
    }
  }

  return TaskResultSchema.parse({
    stepId: request.stepId,
    adapter,
    status: !timedOut && exitCode === 0 ? "passed" : "failed",
    durationMs: Date.now() - startedAt,
    testsRun,
    failures,
    exitCode,
    timedOut,
    stdout: stdoutChunks.join("\n").trim(),
    stderr: stderrChunks.join("\n").trim()
  });
}

async function runNodeValidationScript(
  scriptPath: string,
  projectRoot: string,
  timeoutMs: number
): Promise<ProcessExecutionResult> {
  const wrapperSource = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const Module = require('node:module');",
    "const [projectRoot, scriptPath] = process.argv.slice(1);",
    "process.chdir(projectRoot);",
    "const source = fs.readFileSync(scriptPath, 'utf8');",
    "const virtualEntry = path.join(projectRoot, '__construct_hidden_validation__.js');",
    "const validationModule = new Module(virtualEntry);",
    "validationModule.filename = virtualEntry;",
    "validationModule.paths = Module._nodeModulePaths(projectRoot);",
    "validationModule._compile(source, virtualEntry);"
  ].join("\n");

  try {
    return await runProcess(process.execPath, ["-e", wrapperSource, projectRoot, scriptPath], {
      cwd: projectRoot,
      timeoutMs,
      env: {
        CI: "1"
      }
    });
  } catch (error) {
    if (isMissingBinaryError(error)) {
      throw new BlueprintResolutionError("Unable to locate Node.js in PATH for validation scripts.");
    }

    throw error;
  }
}

function collectNodeValidationFailures(
  request: TaskExecutionRequest,
  testPath: string,
  result: ProcessExecutionResult
): TaskFailure[] {
  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const validationMessages = combinedOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^\[[^\]]+\]\s+/.test(line))
    .map((line) => line.replace(/^\[[^\]]+\]\s+/, "").trim());

  if (validationMessages.length > 0) {
    return validationMessages.map((message) => ({
      testName: path.basename(testPath),
      message,
      ...deriveNodeValidationComparison(message),
      stackTrace: combinedOutput || undefined
    }));
  }

  if (result.timedOut) {
    return [
      {
        testName: path.basename(testPath),
        message: `The validation script timed out after ${request.timeoutMs}ms.`,
        stackTrace: combinedOutput || undefined
      }
    ];
  }

  if ((result.exitCode ?? 0) !== 0) {
    return [
      {
        testName: path.basename(testPath),
        message: summarizeFailureMessage(combinedOutput) || `Validation failed in ${path.basename(testPath)}.`,
        ...extractOutputComparison(combinedOutput),
        stackTrace: combinedOutput || undefined
      }
    ];
  }

  return [];
}

function deriveNodeValidationComparison(message: string): Pick<
  TaskFailure,
  "expectedOutput" | "actualOutput"
> {
  const normalized = message.trim().replace(/\.$/, "");
  const invalidJsonMatch = /^Cannot parse\s+(.+?)\s+as JSON:/i.exec(normalized);

  if (invalidJsonMatch?.[1]) {
    const fileName = path.basename(invalidJsonMatch[1]);
    return {
      expectedOutput: `${fileName} contains valid JSON`,
      actualOutput: `${fileName} contains invalid JSON`
    };
  }

  if (/workspaces missing/i.test(normalized)) {
    return {
      expectedOutput: "root package.json defines workspaces",
      actualOutput: normalized
    };
  }

  const missingAtStart = /^missing\s+(.+)$/i.exec(normalized);
  if (missingAtStart?.[1]) {
    return {
      expectedOutput: `${missingAtStart[1]} exists`,
      actualOutput: normalized
    };
  }

  const missingAtEnd = /^(.+?)\s+missing$/i.exec(normalized);
  if (missingAtEnd?.[1]) {
    return {
      expectedOutput: `${missingAtEnd[1]} exists`,
      actualOutput: normalized
    };
  }

  const unreadable = /^(.+?)\s+unreadable$/i.exec(normalized);
  if (unreadable?.[1]) {
    return {
      expectedOutput: `${unreadable[1]} is readable`,
      actualOutput: normalized
    };
  }

  return {};
}

function isMissingBinaryError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function runPytestCommand(
  request: TaskExecutionRequest
): Promise<{ command: string; result: ProcessExecutionResult }> {
  const pytestArguments = ["-m", "pytest", "-q", ...request.tests];
  const pythonCommands = resolvePythonCommandCandidates(request.projectRoot);

  for (const command of pythonCommands) {
    try {
      const result = await runProcess(command, pytestArguments, {
        cwd: request.projectRoot,
        timeoutMs: request.timeoutMs,
        env: {
          CI: "1"
        }
      });

      return { command, result };
    } catch (error) {
      if (isMissingBinaryError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new BlueprintResolutionError(
    "Unable to locate a Python interpreter in PATH for this project."
  );
}

function resolvePythonCommandCandidates(projectRoot: string): string[] {
  const localVenvCandidates = [
    findUpwardPath(projectRoot, path.join(".construct", "tooling", "pytest-env", "bin", "python3")),
    findUpwardPath(projectRoot, path.join(".construct", "tooling", "pytest-env", "bin", "python"))
  ].filter((candidate): candidate is string => Boolean(candidate));

  return [...localVenvCandidates, "python3", "python"];
}

async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    timeoutMs: number;
  }
): Promise<ProcessExecutionResult> {
  const startedAt = Date.now();
  let timedOut = false;
  let stdout = "";
  let stderr = "";

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, options.timeoutMs);

    timeoutHandle.unref();

    child.once("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.once("close", (code) => {
      clearTimeout(timeoutHandle);
      resolve(code);
    });
  });

  return {
    durationMs: Date.now() - startedAt,
    exitCode,
    stderr,
    stdout,
    timedOut
  };
}

function collectPytestFailures(
  request: TaskExecutionRequest,
  result: ProcessExecutionResult
): TaskFailure[] {
  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const failures = combinedOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = /^FAILED\s+(.+?)(?:\s+-\s+(.+))?$/.exec(line);

      if (!match) {
        return [];
      }

      return [
        {
          testName: match[1],
          message:
            match[2]?.trim() ||
            `Pytest reported a failure in ${match[1]}.`,
          ...extractOutputComparison(combinedOutput),
          stackTrace: combinedOutput || undefined
        }
      ];
    });

  if (failures.length > 0) {
    return failures;
  }

  if (result.timedOut) {
    return [
      {
        testName: request.stepId,
        message: `The pytest process timed out after ${request.timeoutMs}ms.`,
        stackTrace: combinedOutput || undefined
      }
    ];
  }

  if (result.exitCode !== 0) {
    return [
      {
        testName: request.stepId,
        message:
          summarizeFailureMessage(combinedOutput) ||
          "The pytest run failed.",
        stackTrace: combinedOutput || undefined
      }
    ];
  }

  return [];
}

function buildCargoTestArgs(request: TaskExecutionRequest): string[] {
  const integrationTests = extractCargoIntegrationTestNames(request);
  const cargoTestArgs = ["test", "--color", "never"];

  if (integrationTests.length > 0) {
    for (const integrationTest of integrationTests) {
      cargoTestArgs.push("--test", integrationTest);
    }
  }

  return cargoTestArgs;
}

function extractCargoIntegrationTestNames(request: TaskExecutionRequest): string[] {
  const integrationTests: string[] = [];

  for (const testPath of request.tests) {
    const relativePath = path
      .relative(request.projectRoot, testPath)
      .split(path.sep)
      .join("/");

    if (!relativePath.startsWith("tests/") || !relativePath.endsWith(".rs")) {
      return [];
    }

    const testName = relativePath.slice("tests/".length, -".rs".length);

    if (testName.includes("/")) {
      return [];
    }

    integrationTests.push(testName);
  }

  return Array.from(new Set(integrationTests));
}

function collectCargoFailures(
  request: TaskExecutionRequest,
  result: ProcessExecutionResult
): TaskFailure[] {
  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const failingTestNames = Array.from(
    new Set(
      combinedOutput
        .split("\n")
        .map((line) => line.trim())
        .flatMap((line) => {
          const match = /^test\s+(.+?)\s+\.\.\.\s+FAILED$/.exec(line);
          return match ? [match[1]] : [];
        })
    )
  );

  const failures = failingTestNames.map((testName) => ({
    testName,
    message: findCargoFailureMessage(combinedOutput, testName),
    ...extractOutputComparison(extractCargoFailureStackTrace(combinedOutput, testName) ?? ""),
    stackTrace: extractCargoFailureStackTrace(combinedOutput, testName)
  }));

  if (failures.length > 0) {
    return failures;
  }

  if (result.timedOut) {
    return [
      {
        testName: request.stepId,
        message: `The cargo test process timed out after ${request.timeoutMs}ms.`,
        stackTrace: combinedOutput || undefined
      }
    ];
  }

  if (result.exitCode !== 0) {
    return [
      {
        testName: request.stepId,
        message:
          summarizeFailureMessage(combinedOutput) ||
          "The cargo test run failed.",
        stackTrace: combinedOutput || undefined
      }
    ];
  }

  return [];
}

function findCargoFailureMessage(combinedOutput: string, testName: string): string {
  const stackTrace = extractCargoFailureStackTrace(combinedOutput, testName);
  return summarizeFailureMessage(stackTrace || `Cargo reported a failure in ${testName}.`);
}

function extractCargoFailureStackTrace(
  combinedOutput: string,
  testName: string
): string | undefined {
  const sectionHeader = `---- ${testName} stdout ----`;
  const headerIndex = combinedOutput.indexOf(sectionHeader);

  if (headerIndex === -1) {
    return undefined;
  }

  const section = combinedOutput.slice(headerIndex).split("\n---- ")[0]?.trim();
  return section || undefined;
}

async function walkDirectory(
  directoryPath: string,
  onFile: (filePath: string) => Promise<void>
): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(entryPath, onFile);
      continue;
    }

    if (entry.isFile()) {
      await onFile(entryPath);
    }
  }
}

function findFirstExistingPath(rootDirectory: string, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const candidatePath = path.join(rootDirectory, candidate);

    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

function findFirstUpwardExistingPath(
  startDirectory: string,
  candidates: string[]
): string | undefined {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    const candidatePath = findFirstExistingPath(currentDirectory, candidates);

    if (candidatePath) {
      return candidatePath;
    }

    const nextDirectory = path.dirname(currentDirectory);

    if (nextDirectory === currentDirectory) {
      return undefined;
    }

    currentDirectory = nextDirectory;
  }
}

export function findUpwardJestBinaryPath(startDirectory: string): string | undefined {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    const directBinaryPath = path.join(
      currentDirectory,
      "node_modules",
      "jest",
      "bin",
      "jest.js"
    );

    if (existsSync(directBinaryPath)) {
      return directBinaryPath;
    }

    const pnpmBinaryPath = findPnpmPackageBinaryPath(
      path.join(currentDirectory, "node_modules", ".pnpm"),
      "jest",
      path.join("node_modules", "jest", "bin", "jest.js")
    );

    if (pnpmBinaryPath) {
      return pnpmBinaryPath;
    }

    const nextDirectory = path.dirname(currentDirectory);

    if (nextDirectory === currentDirectory) {
      return undefined;
    }

    currentDirectory = nextDirectory;
  }
}

function findPnpmPackageBinaryPath(
  pnpmStoreDirectory: string,
  packageName: string,
  binaryRelativePath: string
): string | undefined {
  if (!existsSync(pnpmStoreDirectory)) {
    return undefined;
  }

  for (const entry of readdirSync(pnpmStoreDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${packageName}@`)) {
      continue;
    }

    const candidatePath = path.join(pnpmStoreDirectory, entry.name, binaryRelativePath);

    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

function findUpwardPath(startDirectory: string, relativePath: string): string | undefined {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    const candidatePath = path.join(currentDirectory, relativePath);

    if (existsSync(candidatePath)) {
      return candidatePath;
    }

    const nextDirectory = path.dirname(currentDirectory);

    if (nextDirectory === currentDirectory) {
      return undefined;
    }

    currentDirectory = nextDirectory;
  }
}

function resolveToRealPath(candidatePath: string): string {
  const resolvedPath = path.resolve(candidatePath);

  try {
    return realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

async function runFromCli(): Promise<void> {
  const parsedArguments = parseArgs({
    args: process.argv.slice(2),
    options: {
      all: {
        type: "boolean",
        default: false
      },
      blueprint: {
        type: "string"
      },
      step: {
        type: "string"
      },
      timeout: {
        type: "string"
      }
    }
  });

  const timeoutMs = parsedArguments.values.timeout
    ? Number(parsedArguments.values.timeout)
    : DEFAULT_TIMEOUT_MS;
  const testRunner = new TestRunnerManager();

  const result = parsedArguments.values.all
    ? await testRunner.runBlueprintSuite({
        blueprintPath: parsedArguments.values.blueprint ?? defaultBlueprintPath,
        timeoutMs
      })
    : await testRunner.runBlueprintStep({
        blueprintPath: parsedArguments.values.blueprint ?? defaultBlueprintPath,
        stepId: parsedArguments.values.step ?? "step.state-merge",
        timeoutMs
      });

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "passed" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFromCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
