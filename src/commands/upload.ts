import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { parseFlags } from "../cli/parse.js";
import { redactForOutput } from "../core/redaction.js";
import { callToolWithRetry } from "./call.js";
import { showHelpIfRequested } from "./help.js";
import type { CommandContext } from "./context.js";

const CREATE_STAGED_UPLOAD_TOOL_NAME = "create_staged_upload";
const COMPLETE_STAGED_UPLOAD_TOOL_NAME = "complete_staged_upload";
const ABORT_STAGED_UPLOAD_TOOL_NAME = "abort_staged_upload";
const SOURCE_ZIP_CONTENT_TYPE = "application/zip";
const DEFAULT_STAGED_UPLOAD_TIMEOUT_SECONDS = 600;
const SOURCE_ZIP_CONTENT_TYPES = new Set(["application/zip", "application/x-zip-compressed"]);
const COVER_IMAGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);
const AVATAR_IMAGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const COVER_IMAGE_CONTENT_TYPE_HELP = "image/png, image/jpeg, image/webp, or image/avif";
const AVATAR_IMAGE_CONTENT_TYPE_HELP = "image/png, image/jpeg, image/webp, or image/gif";
const IMAGE_CONTENT_TYPE_BY_EXT = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".gif", "image/gif"],
]);
type UploadKind = "source_zip" | "cover_image" | "avatar_image";

type DirectPutInstructions = {
  presignedUrl: string;
  headers: Record<string, string>;
};

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError(
      "mcp.staged_upload_contract",
      `${label} was missing from the MCP response.`,
      EXIT_CODES.protocol
    );
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readHeaders(value: unknown): Record<string, string> {
  const raw = readObject(value, "staged upload PUT headers");
  const headers: Record<string, string> = {};
  for (const [key, nested] of Object.entries(raw)) {
    if (typeof nested === "string") headers[key] = nested;
  }
  return headers;
}

function readCreateResult(result: unknown): {
  uploadId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  directPut: DirectPutInstructions;
} {
  const toolResult = readObject(result, "create_staged_upload result");
  const structuredContent = readObject(toolResult["structuredContent"], "create_staged_upload structuredContent");
  const meta = readObject(toolResult["_meta"], "create_staged_upload metadata");
  const directPut = readObject(meta["stagedUploadDirectPut"], "staged upload direct PUT metadata");
  const uploadId = readString(structuredContent["uploadId"]);
  const fileName = readString(structuredContent["fileName"]);
  const contentType = readString(structuredContent["contentType"]);
  const sizeBytes = readNumber(structuredContent["sizeBytes"]);
  const presignedUrl = readString(directPut["presignedUrl"]);
  if (!uploadId || !fileName || !contentType || sizeBytes === undefined || !presignedUrl) {
    throw new CliError(
      "mcp.staged_upload_contract",
      "create_staged_upload returned an incomplete staged upload contract.",
      EXIT_CODES.protocol
    );
  }
  return {
    uploadId,
    fileName,
    contentType,
    sizeBytes,
    directPut: {
      presignedUrl,
      headers: readHeaders(directPut["headers"] ?? {}),
    },
  };
}

function readCompleteResult(result: unknown, fallbackUploadId: string): {
  uploadId: string;
  status: string;
  sha256: string;
} {
  const toolResult = readObject(result, "complete_staged_upload result");
  const structuredContent = readObject(toolResult["structuredContent"], "complete_staged_upload structuredContent");
  return {
    uploadId: readString(structuredContent["uploadId"]) ?? fallbackUploadId,
    status: readString(structuredContent["status"]) ?? "verified",
    sha256: readString(structuredContent["sha256"]) ?? "",
  };
}

function parseUploadArgs(args: string[]): {
  filePath: string;
  kind: UploadKind;
  contentType?: string;
  idempotencyKey?: string;
  rootHint?: string;
  entryHint?: string;
  timeoutSeconds: number;
  allowLogin: boolean;
} {
  const { flags, positionals } = parseFlags(args, {
    valueFlags: ["zip", "image", "file", "kind", "content-type", "idempotency-key", "root-hint", "entry-hint", "timeout-sec"],
    booleanFlags: ["no-login"]
  });
  const zipPath = readString(flags["zip"]);
  const imagePath = readString(flags["image"]);
  if (zipPath && imagePath) {
    throw new CliError("usage.upload_single_source", "Use either --zip or --image, not both.", EXIT_CODES.usage);
  }
  const filePath = zipPath ?? imagePath ?? readString(flags["file"]) ?? readString(positionals[0]);
  if (!filePath) {
    throw new CliError(
      "usage.upload_zip_required",
      "Usage: vibecodr upload --zip <path> or vibecodr upload --image <path> [--kind cover_image|avatar_image]",
      EXIT_CODES.usage
    );
  }
  if (positionals.length > 1) {
    throw new CliError("usage.unexpected_argument", `Unexpected argument: ${positionals[1]}`, EXIT_CODES.usage);
  }
  const idempotencyKey = readString(flags["idempotency-key"]);
  const rootHint = readString(flags["root-hint"]);
  const entryHint = readString(flags["entry-hint"]);
  const contentType = readString(flags["content-type"]);
  const timeoutSeconds = parseUploadTimeoutSeconds(flags["timeout-sec"]);
  const rawKind = readString(flags["kind"]);
  let kind: UploadKind = imagePath ? "cover_image" : "source_zip";
  if (rawKind) {
    if (rawKind !== "source_zip" && rawKind !== "cover_image" && rawKind !== "avatar_image") {
      throw new CliError(
        "usage.upload_kind_invalid",
        "--kind must be source_zip, cover_image, or avatar_image.",
        EXIT_CODES.usage
      );
    }
    kind = rawKind;
  }
  if (imagePath && kind === "source_zip") {
    throw new CliError(
      "usage.upload_kind_invalid",
      "--image must use --kind cover_image or --kind avatar_image.",
      EXIT_CODES.usage
    );
  }
  return {
    filePath,
    kind,
    ...(contentType ? { contentType } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(rootHint ? { rootHint } : {}),
    ...(entryHint ? { entryHint } : {}),
    timeoutSeconds,
    allowLogin: flags["no-login"] !== true,
  };
}

function parseUploadTimeoutSeconds(value: unknown): number {
  if (value === undefined) return DEFAULT_STAGED_UPLOAD_TIMEOUT_SECONDS;
  if (typeof value !== "string" || !value.trim()) {
    throw new CliError("usage.upload_timeout_invalid", "--timeout-sec must be a positive number of seconds.", EXIT_CODES.usage);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError("usage.upload_timeout_invalid", "--timeout-sec must be a positive number of seconds.", EXIT_CODES.usage);
  }
  return parsed;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeContentType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() || "";
}

function assertContentTypeForKind(kind: UploadKind, contentType: string): string {
  const normalized = normalizeContentType(contentType);
  if (kind === "source_zip") {
    if (!SOURCE_ZIP_CONTENT_TYPES.has(normalized)) {
      throw new CliError(
        "usage.upload_content_type_invalid",
        "ZIP uploads must use application/zip or application/x-zip-compressed.",
        EXIT_CODES.usage
      );
    }
    return normalized;
  }
  const allowed =
    kind === "cover_image" ? COVER_IMAGE_CONTENT_TYPES : AVATAR_IMAGE_CONTENT_TYPES;
  if (!allowed.has(normalized)) {
    throw new CliError(
      "usage.upload_content_type_invalid",
      kind === "cover_image"
        ? `Cover images must use ${COVER_IMAGE_CONTENT_TYPE_HELP}.`
        : `Avatar images must use ${AVATAR_IMAGE_CONTENT_TYPE_HELP}.`,
      EXIT_CODES.usage
    );
  }
  return normalized;
}

function inferContentType(kind: UploadKind, fileName: string, override?: string): string {
  if (override) return assertContentTypeForKind(kind, override);
  if (kind === "source_zip") return assertContentTypeForKind(kind, SOURCE_ZIP_CONTENT_TYPE);
  const lower = fileName.toLowerCase();
  for (const [ext, contentType] of IMAGE_CONTENT_TYPE_BY_EXT) {
    if (lower.endsWith(ext)) return assertContentTypeForKind(kind, contentType);
  }
  throw new CliError(
    "usage.upload_image_type_required",
    `Could not infer image content type. Cover images support ${COVER_IMAGE_CONTENT_TYPE_HELP}; avatar images support ${AVATAR_IMAGE_CONTENT_TYPE_HELP}.`,
    EXIT_CODES.usage
  );
}

function toBlob(bytes: Uint8Array, contentType: string): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: contentType });
}

async function abortBestEffort(context: CommandContext, uploadId: string, allowLogin: boolean, timeoutSeconds: number): Promise<void> {
  try {
    await callToolWithRetry(context, ABORT_STAGED_UPLOAD_TOOL_NAME, { uploadId }, allowLogin, { timeoutSeconds });
  } catch {
    // Best-effort cleanup only. Preserve the upload failure as the surfaced error.
  }
}

async function putBytesToStagedUpload(input: {
  fileName: string;
  bytes: Uint8Array;
  contentType: string;
  directPut: DirectPutInstructions;
}): Promise<void> {
  const response = await fetch(input.directPut.presignedUrl, {
    method: "PUT",
    headers: input.directPut.headers,
    body: toBlob(input.bytes, input.contentType),
  });
  if (!response.ok) {
    throw new CliError(
      "upload.put_failed",
      `Upload failed for ${input.fileName} with HTTP ${response.status}.`,
      EXIT_CODES.network,
      { nextStep: "Retry the command. If this repeats, run vibecodr doctor and check upload service status." }
    );
  }
}

export async function runUploadCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr upload --zip <path> [--idempotency-key <key>] [--root-hint <path>] [--entry-hint <path>] [--timeout-sec <n>] [--no-login]\n       vibecodr upload --image <path> [--kind cover_image|avatar_image] [--content-type <mime>] [--timeout-sec <n>] [--no-login]")) return;
  const input = parseUploadArgs(args);
  const fileInfo = await stat(input.filePath).catch((error: unknown) => {
    throw new CliError(
      "usage.upload_file_unreadable",
      `Could not read upload file: ${error instanceof Error ? error.message : String(error)}`,
      EXIT_CODES.usage
    );
  });
  if (!fileInfo.isFile()) {
    throw new CliError("usage.upload_file_required", "Upload path must be a file.", EXIT_CODES.usage);
  }
  if (fileInfo.size <= 0) {
    throw new CliError("usage.upload_file_empty", "Upload file must not be empty.", EXIT_CODES.usage);
  }

  const bytes = await readFile(input.filePath);
  const fileName = basename(input.filePath) || (input.kind === "source_zip" ? "source.zip" : "image");
  const contentType = inferContentType(input.kind, fileName, input.contentType);
  const hash = sha256Hex(bytes);
  const mcpRequestOptions = { timeoutSeconds: input.timeoutSeconds };
  const { result: createResult } = await callToolWithRetry(context, CREATE_STAGED_UPLOAD_TOOL_NAME, {
    kind: input.kind,
    fileName,
    contentType,
    sizeBytes: bytes.byteLength,
    sha256: hash,
    createdBySurface: input.kind === "source_zip" ? "cli.upload.zip" : "cli.upload.image",
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  }, input.allowLogin, mcpRequestOptions);
  const created = readCreateResult(createResult);

  try {
    await putBytesToStagedUpload({
      fileName: created.fileName,
      bytes,
      contentType: created.contentType,
      directPut: created.directPut,
    });
    const { result: completeResult } = await callToolWithRetry(context, COMPLETE_STAGED_UPLOAD_TOOL_NAME, {
      uploadId: created.uploadId,
      sizeBytes: bytes.byteLength,
      sha256: hash,
    }, input.allowLogin, mcpRequestOptions);
    const completed = readCompleteResult(completeResult, created.uploadId);
    const quickPublishPayload = {
      ...(input.kind === "source_zip"
        ? {
            importMode: "staged_upload",
            stagedUpload: {
              uploadId: completed.uploadId,
              fileName: created.fileName,
              async: true,
              ...(input.rootHint ? { rootHint: input.rootHint } : {}),
              ...(input.entryHint ? { entryHint: input.entryHint } : {}),
            },
          }
        : input.kind === "cover_image"
          ? {
              thumbnailStagedUpload: {
                uploadId: completed.uploadId,
                fileName: created.fileName,
              },
            }
          : {
              avatarStagedUpload: {
                uploadId: completed.uploadId,
                fileName: created.fileName,
              },
            }),
    };

    context.output.success(
      {
        schemaVersion: 1,
        upload: {
          uploadId: completed.uploadId,
          status: completed.status,
          kind: input.kind,
          fileName: created.fileName,
          contentType: created.contentType,
          sizeBytes: bytes.byteLength,
          sha256: completed.sha256 || hash,
        },
        quickPublishPayload: redactForOutput(quickPublishPayload),
      },
      [
        `Uploaded and verified ${created.fileName}.`,
        input.kind === "source_zip"
          ? `Use uploadId ${completed.uploadId} with payload.importMode="staged_upload"; larger projects will move to Vibecodr's heavy import lane automatically.`
          : input.kind === "cover_image"
            ? `Use uploadId ${completed.uploadId} with thumbnailStagedUpload.uploadId.`
            : `Use uploadId ${completed.uploadId} with an avatar image promotion flow.`,
      ]
    );
  } catch (error) {
    await abortBestEffort(context, created.uploadId, input.allowLogin, input.timeoutSeconds);
    throw error;
  }
}
