// Reads and extracts the workspace archives the panel previews.
//
// Both container formats are read by a mature parser, and only the policy is
// ours: `zip` through `yauzl`, `tar` / `.tar.gz` through `tar`. The gzip is
// decompressed here first, under the same uncompressed cap, so that cap is not
// handed to a library to enforce. T16 replaced two hand-written walks — a
// central-directory walk with `inflateRawSync`, and a 512-byte header walk with
// its own checksum, base-256 and pax readers — because reimplementing a mature
// format is not something to keep for its own sake.
//
// The module is organised in three responsibilities, in this order:
//
//   * parser — one adapter per format, each translating its parser's entry and
//     failure vocabulary into this module's. A parser reads bytes and names; it
//     never decides whether an entry may be written.
//   * policy — `normalizeEntryName`, `nameVerdict`, `resolveInside`,
//     `resolveEntryPath`, the refusal vocabulary and the byte/ratio budgets.
//     Both operations call the SAME implementations; nothing here is
//     per-operation.
//   * workflow — `readWorkspaceArchiveListing` and
//     `extractWorkspaceArchiveDirectory`: the two public operations, their
//     two-phase shape (every name and declared size validated before anything
//     is created; no file ever left half-written) and the per-format extraction
//     pass, because `yauzl` can re-open an entry after the walk and `tar`
//     cannot.
//
// The hardening is ported from the runtime's two battle-tested extractors:
//   * `packages/local-runtime/src/website-management/deployed-website-source.ts`
//     — `extractArchive`, `assertSafeZipEntry`, `isSymbolicLink`,
//     `resolveEntryPath`, `readUncompressedSize`.
//   * `packages/local-runtime/src/skills/remote/archive.ts` —
//     `loadZipSkillFiles`, `shouldStripArchiveRoot`.
// Neither can be imported across the package boundary (webui may not depend on
// local-runtime, and the runtime already depends on webui), so the checks are
// re-implemented against the raw bytes and the two-phase shape is kept: every
// entry is validated and the declared sizes summed *before* a single byte is
// written, so a hostile archive leaves nothing behind.
//
// `shouldStripArchiveRoot` is the one deliberate non-port — see the comment on
// `listOneLevel`.

import { lstat, mkdir, open, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import type {
  WebuiArchiveEntry,
  WebuiWorkspaceArchiveExtractResult,
  WebuiWorkspaceArchiveListing,
} from "../shared/contracts/workspace.js";

// ---------------------------------------------------------------------------
// Ceilings
// ---------------------------------------------------------------------------

/**
 * Largest compressed archive this module will read into memory.
 *
 * 200 MiB, the same figure `deployed-website-source.ts` uses for a *downloaded*
 * archive. The panel is previewing a file the user already has in their own
 * workspace tree, so nothing is arriving over a network, and a cap far below
 * this would refuse legitimate build outputs (`target/`, `.next/`) that are
 * routinely zipped up and opened for inspection.
 */

// ---------------------------------------------------------------------------
// The zip parser
// ---------------------------------------------------------------------------

/**
 * `yauzl`, loaded through `require` and typed here (T16).
 *
 * yauzl ships no declarations, and an ambient `declare module "yauzl"` is
 * ignored while the specifier still resolves to the package's JavaScript — which
 * is why the type lives at the use site, shaped to what this module calls, the
 * same way the terminal manager types `node-pty`. The fields below were read
 * from `node_modules/yauzl/index.js` (v3.4.0).
 */
type ZipParserEntry = {
  readonly fileName: string;
  readonly uncompressedSize: number;
  readonly compressedSize: number;
  readonly externalFileAttributes: number;
  readonly versionMadeBy: number;
};

type ZipParserFile = {
  readEntry(): void;
  openReadStreamPromise(entry: ZipParserEntry): Promise<NodeJS.ReadableStream>;
  close(): void;
  on(event: "entry", listener: (entry: ZipParserEntry) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  removeListener(event: "entry", listener: (entry: ZipParserEntry) => void): void;
  removeListener(event: "end", listener: () => void): void;
  removeListener(event: "error", listener: (error: Error) => void): void;
};

type ZipParserModule = {
  fromBufferPromise(
    buffer: Buffer,
    options?: {
      readonly lazyEntries?: boolean;
      readonly decodeStrings?: boolean;
      readonly validateEntrySizes?: boolean;
      readonly autoClose?: boolean;
    },
  ): Promise<ZipParserFile>;
};

const require = createRequire(import.meta.url);

/** Resolved per call so a missing optional dependency fails only when used. */
function loadZipParser(): ZipParserModule {
  return require("yauzl") as ZipParserModule;
}

const WORKSPACE_ARCHIVE_MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

/**
 * Largest total expansion, enforced against the declared sizes (before
 * inflating anything), against the bytes each entry actually produced (after),
 * and *during* inflation via zlib's `maxOutputLength`.
 *
 * 512 MiB, matching `DEPLOYED_WEBSITE_SOURCE_MAX_UNCOMPRESSED_BYTES`. The
 * declared pass is the cheap pre-flight; the runtime pass is the one that
 * matters, because a header can lie. Enforcing it during inflation rather than
 * after is what stops a lying header from getting to allocate the memory it
 * asked for in the first place.
 */
const WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

/**
 * Per-entry expansion ceiling: `uncompressed / compressed`.
 *
 * DEFLATE's format maximum is about 1032:1 (a 258-byte match encoded in a
 * fraction of a token), so 2000:1 admits everything a conforming compressor can
 * emit — including a maximally compressible file of zeroes — while still
 * refusing the classic "a 1 KB archive expands to gigabytes" shape entry by
 * entry. The absolute total-bytes cap is the real memory guard; this one exists
 * so a single member cannot quietly consume the whole budget.
 */
const WORKSPACE_ARCHIVE_MAX_EXPANSION_RATIO = 2000;

/**
 * Most entries the reader will materialise.
 *
 * 10,000, one notch above the sibling extractor's 5,000. The difference is the
 * consumer: a headless install has to *write* every entry, while this reader
 * only ever renders one level, so the ceiling exists to bound parse memory
 * rather than disk. "A zip with a million tiny entries" is the shape that would
 * exhaust memory while building a listing, and 10,000 stays two orders of
 * magnitude below it while remaining past any real project tree.
 */
const WORKSPACE_ARCHIVE_MAX_ENTRIES = 10_000;

/**
 * Most rows one listing level reports before it declares itself truncated.
 *
 * 500, the same page size the workspace directory picker uses
 * (`WORKSPACE_DIRECTORY_LIMIT` in `src/server/operation/workspace.ts`): enough
 * for a directory to stay browsable, few enough that the response does not.
 * The entry ceiling above sits well past this, so `totalEntries` can honestly
 * report how much of the archive the page left out.
 */
const WORKSPACE_ARCHIVE_MAX_LISTED_ENTRIES = 500;

// ---------------------------------------------------------------------------
// Format set
// ---------------------------------------------------------------------------

/**
 * The extensions the client routes to the archive preview, mirrored from
 * `WORKSPACE_ARCHIVE_EXTENSIONS` in `src/client/features/workspace/ui/WorkspacePanels.tsx`.
 *
 * Mirrored rather than imported because that module is browser-side and this is
 * the server, but the two lists must not drift: a format this module cannot
 * read still has to be a *recognised* archive here, so the user gets "unsupported
 * format" rather than "this is not an archive". Which of them can actually be
 * opened is decided by `archiveFormatFor`.
 */
const WORKSPACE_ARCHIVE_EXTENSIONS = [
  ".zip",
  ".tar",
  ".tgz",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
] as const;

type ArchiveFormat = "zip" | "tar" | "tar.gz";

/**
 * Which of the client's extensions this reader can open, and by what name it
 * refuses the rest.
 *
 * `.gz` is in the client list as a suffix match, so `x.tar.gz` routes here too;
 * a bare `.gz` is one compressed stream with no directory structure and no way
 * to tell a gzipped tar from a gzipped text file, so it is refused rather than
 * guessed at. `.bz2` and `.xz` have no decompressor in `node:zlib`. `.7z` and
 * `.rar` are proprietary container formats this module does not parse.
 */
function archiveFormatFor(archivePath: string): { readonly format: ArchiveFormat } | { readonly error: string } {
  const lower = archivePath.toLowerCase();
  if (!WORKSPACE_ARCHIVE_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return { error: "只有 .zip、.tar、.tgz 和 .tar.gz 可以在工作区面板中打开。" };
  }
  if (lower.endsWith(".zip")) return { format: "zip" };
  if (lower.endsWith(".tgz") || lower.endsWith(".tar.gz")) return { format: "tar.gz" };
  if (lower.endsWith(".tar")) return { format: "tar" };
  if (lower.endsWith(".gz")) return { error: ".gz 是单个压缩流、没有目录结构；请改用 .tar.gz 或 .tgz。" };
  if (lower.endsWith(".bz2") || lower.endsWith(".xz")) {
    return { error: "Node 内置压缩库不支持 bzip2 或 xz；请改用 .zip、.tar 或 .tar.gz。" };
  }
  return { error: "不支持的压缩包格式（.7z / .rar）；请改用 .zip、.tar 或 .tar.gz。" };
}

// ---------------------------------------------------------------------------
// Entry model
// ---------------------------------------------------------------------------

type ArchiveEntry = {
  /** The name exactly as the container stored it, before normalisation. */
  readonly rawName: string;
  /**
   * Archive-internal POSIX path, absent when `unsafeReason` is set. An entry
   * without a path is never named to the client and never written.
   */
  readonly path?: string;
  readonly isDirectory: boolean;
  /** Size the container claims for this entry; the header may be lying. */
  readonly declaredSize: number;
  /** Compressed size, the denominator of the expansion-ratio ceiling. */
  readonly compressedSize: number;
  /** Why this entry is refused, in the panel's own words. */
  readonly unsafeReason?: string;
  /**
   * Materialises the entry's bytes, charged against `budget`.
   *
   * Carried by zip entries only: `yauzl` hands out a stream per entry and the
   * central directory is still open, so the bytes can be read after the walk.
   * `tar` cannot re-open an entry, so tar entries have no `read` — their bytes
   * are written by `writeTarSelection`'s own streaming pass.
   */
  read?(budget: ExpansionBudget): Promise<Buffer>;
};

type ArchiveContents = {
  readonly entries: readonly ArchiveEntry[];
  /** Entries the archive holds, which may exceed `entries.length`. */
  readonly totalEntries: number;
  /** True when the entry ceiling cut the container short. */
  readonly truncated: boolean;
  /**
   * Releases the parser's handle. A zip's `ZipFile` must outlive every
   * `entry.read`, so the reader that opened it closes it here once the
   * operation is done; the tar half has nothing to release.
   */
  readonly close?: () => void;
};

/**
 * Byte budget shared by every entry in one operation, so neither the
 * per-entry ratio ceiling nor the total cap can be sidestepped by splitting a
 * bomb across many entries.
 */
type ExpansionBudget = { remaining: number };

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * One level of an archive, as the panel's preview shows it.
 *
 * The read path only ever names entries it is willing to write, which is what
 * the port's contract asks for ("the view renders only what this call is willing
 * to name"): an entry whose name is unsafe is dropped and the listing is marked
 * truncated, rather than displayed now and refused at extraction time.
 */
export async function readWorkspaceArchiveListing(request: {
  readonly workspaceDir: string;
  readonly path: string;
  readonly prefix?: string;
}): Promise<WebuiWorkspaceArchiveListing> {
  const archivePath = await resolveArchiveFile(request.workspaceDir, request.path);
  const { format, buffer } = await readArchive(archivePath);
  const prefix = normalizePrefix(request.prefix);
  const contents = await readContents(buffer, format);
  const level = listOneLevel(contents, prefix);
  try {
  return {
    archivePath: normalizeArchiveRelativePath(request.path),
    entries: level.entries,
    totalEntries: contents.totalEntries,
    // Two honest reasons to be truncated, and the view has to say so either way
    // rather than render a partial list as if it were the whole archive: the
    // reader stopped at the entry ceiling, or this one level held more rows
    // than a page carries (or an entry the reader refused to name).
    truncated: contents.truncated || level.truncated,
  };
  } finally {
    contents.close?.();
  }
}

/**
 * Writes the entries under `prefix` (or the whole archive) into `destination`.
 *
 * `destination` is a path *inside* the workspace, chosen by the view: a browser
 * cannot ask for an arbitrary absolute path, and a free-text destination would
 * make this a path-traversal endpoint rather than a feature. It is resolved and
 * validated against the workspace root before anything is created, and every
 * written path is re-validated against the extraction root after joining, so a
 * hostile entry name cannot escape either one.
 *
 * Two phases, as in the sibling extractor: every name is validated and the
 * declared sizes summed *before* the destination is created, so an archive with
 * a hostile name or a lying header leaves nothing at all behind. A failure
 * discovered per entry — a corrupt stream, an expansion blow-up, a file that
 * already exists — happens after some directories exist, and the invariant
 * there is that no *file* is ever half-written: bytes are read in full, capped
 * and checked before `writeFile` is called.
 */
export async function extractWorkspaceArchiveDirectory(request: {
  readonly workspaceDir: string;
  readonly path: string;
  readonly destination: string;
  readonly prefix?: string;
}): Promise<WebuiWorkspaceArchiveExtractResult> {
  const archivePath = await resolveArchiveFile(request.workspaceDir, request.path);
  const { format, buffer } = await readArchive(archivePath);
  const prefix = normalizePrefix(request.prefix);
  const contents = await readContents(buffer, format);
  try {
  const selected = selectForExtraction(contents, prefix);

  let declared = 0;
  for (const entry of selected) {
    if (entry.unsafeReason) throw new Error(`压缩包中存在不安全的条目：${entry.unsafeReason}`);
    declared += entry.declaredSize;
    if (declared > WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES) {
      throw new Error("压缩包声明的展开后体积过大，已拒绝解压。");
    }
  }

  const root = await prepareExtractionRoot(request.workspaceDir, request.destination);
  const budget: ExpansionBudget = { remaining: WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES };
  // tar cannot re-open an entry after its walk, so its bytes are written by a
  // second streaming pass; a zip entry is read lazily instead, from the central
  // directory the parse left open.
  const writtenFiles =
    format === "tar"
      ? await writeTarSelection(buffer, selected, prefix, root, budget)
      : await writeZipSelection(root, selected, prefix, budget);

  return {
    archivePath: normalizeArchiveRelativePath(request.path),
    destination: normalizeArchiveRelativePath(request.destination),
    writtenFiles,
    // The port asks for this rather than a refusal: the destination now holds a
    // partial tree, and the view has to say so instead of implying the archive
    // was written out in full.
    ...(contents.truncated ? { truncated: true } : {}),
  };
  } finally {
    // The zip parser's handle has to outlive every entry read above, so it is
    // released here rather than inside the parse.
    contents.close?.();
  }
}

// ---------------------------------------------------------------------------
// Workspace path handling
// ---------------------------------------------------------------------------

/**
 * Resolves the archive's own path inside the workspace.
 *
 * The relative path arrives from the browser, so it gets the same treatment as
 * an entry name: `resolve` collapses every `..`, and what is left to reject is
 * an absolute path or a sibling that merely shares a prefix (`/repo-evil`
 * against root `/repo`) — hence the separator-terminated comparison rather than
 * a bare `startsWith(root)`.
 */
async function resolveArchiveFile(workspaceDir: string, relative: string): Promise<string> {
  if (!relative.trim()) throw new Error("压缩包路径为空。");
  const root = await realpath(path.resolve(workspaceDir));
  const target = resolveInside(root, relative, "压缩包路径");
  let stats;
  try {
    stats = await stat(target);
  } catch (error) {
    if (isMissingPath(error)) throw new Error("工作区中找不到这个压缩包。");
    throw error;
  }
  if (!stats.isFile()) throw new Error("压缩包不是一个文件。");
  // Checked before `readFile`, so an oversized archive is refused rather than
  // allocated and then refused.
  if (stats.size > WORKSPACE_ARCHIVE_MAX_ARCHIVE_BYTES) throw new Error("压缩包过大，无法在面板中打开。");
  return target;
}

/**
 * Validates and creates the directory an extraction may write into.
 *
 * The destination is untrusted input like everything else here: resolved
 * against the workspace root, refused if it lands outside, and re-checked
 * *after* `realpath` so a symlinked ancestor cannot redirect the writes
 * somewhere else. Only then is anything created — a refused destination must
 * not leave a directory behind.
 */
async function prepareExtractionRoot(workspaceDir: string, destination: string): Promise<string> {
  if (!destination.trim()) throw new Error("解压目标为空。");
  const root = await realpath(path.resolve(workspaceDir));
  const requested = resolveInside(root, destination, "解压目标");
  await mkdir(requested, { recursive: true });
  const resolved = await realpath(requested);
  // Re-anchored on the resolved path: the same check that passed above can pass
  // through a symlinked ancestor, and only the resolved pair proves containment.
  resolveInside(root, resolved, "解压目标");
  const stats = await lstat(resolved);
  if (stats.isSymbolicLink()) throw new Error("解压目标不能是符号链接。");
  if (!stats.isDirectory()) throw new Error("解压目标不是一个目录。");
  return resolved;
}

/**
 * `resolve`, then a separator-terminated containment check.
 *
 * Ported from `resolveEntryPath` in `deployed-website-source.ts` and kept in
 * the form the sibling's own comment argues for: a string prefix wrongly
 * accepts `/tmp/evil` for a root of `/tmp/ev`.
 */
function resolveInside(root: string, name: string, what: string): string {
  const destination = path.resolve(root, name);
  if (destination !== root && !destination.startsWith(rootPrefix(root))) {
    throw new Error(`${what}越界：${name}`);
  }
  return destination;
}

/** The same check, re-anchored on the extraction root for one entry name. */
function resolveEntryPath(root: string, name: string): string {
  const destination = path.resolve(root, name);
  if (destination !== root && !destination.startsWith(rootPrefix(root))) {
    throw new Error(`压缩包条目越界：${name}`);
  }
  return destination;
}

function rootPrefix(root: string): string {
  return root.endsWith(path.sep) ? root : `${root}${path.sep}`;
}

// ---------------------------------------------------------------------------
// Name normalisation
// ---------------------------------------------------------------------------

/**
 * Ported from `assertSafeZipEntry` in `deployed-website-source.ts`, widened from
 * zip to every container: no NUL, not absolute on any platform, no `..`
 * segment, and no Windows drive letter.
 *
 * Two deliberate differences from the sibling, both about not refusing archives
 * that are not attacks:
 *
 *   * A `.` segment is *dropped* rather than refused. `tar cf x.tar .` and
 *     `zip -r x.zip .` put `./` on every single member, so the sibling's rule
 *     would make the most common tarball in existence unreadable. A `.` cannot
 *     escape anything — `resolve` collapses it — and the traversal that matters,
 *     `..`, stays refused.
 *   * A name that normalises away to nothing (`./`, `.`) is reported as a *root
 *     marker* rather than as a refusal, because it is the container saying
 *     "this archive is rooted here", not content. Counting it as refused would
 *     mark every such archive truncated.
 *
 * The drive-letter clause is the one `win32.isAbsolute` does not cover on its
 * own — it accepts `C:\x` but not the drive-relative `C:x`, which resolves to
 * that drive's current directory on Windows.
 */
type NormalizedName = { readonly path: string } | { readonly root: true } | { readonly reason: string };

function normalizeEntryName(rawName: string): NormalizedName {
  if (!rawName) return { reason: "条目名为空" };
  if (rawName.includes("\0")) return { reason: "条目名包含 NUL 字节" };
  const unified = rawName.replace(/\\/gu, "/");
  if (
    unified.startsWith("/") ||
    path.isAbsolute(rawName) ||
    path.posix.isAbsolute(unified) ||
    path.win32.isAbsolute(rawName)
  ) {
    return { reason: "条目名是绝对路径" };
  }
  const parts = unified.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.some((part) => part === "..")) return { reason: "条目名包含 .. 路径段" };
  if (parts.length === 0) return { root: true };
  if (/^[A-Za-z]:/u.test(parts[0]!)) return { reason: "条目名包含 Windows 盘符" };
  return { path: parts.join("/") };
}

/** A normalised name resolved into what an entry should carry. */
type NameVerdict = { readonly path?: string; readonly reason?: string; readonly drop?: boolean };

function nameVerdict(normalized: NormalizedName, isDirectory: boolean): NameVerdict {
  if ("root" in normalized) return isDirectory ? { drop: true } : { reason: "条目名为空" };
  if ("reason" in normalized) return { reason: normalized.reason };
  return { path: normalized.path };
}

/** The workspace-relative form echoed back to the client for display. */
function normalizeArchiveRelativePath(value: string): string {
  const normalized = normalizeEntryName(value);
  return "path" in normalized ? normalized.path : "root" in normalized ? "" : value;
}

/**
 * The prefix a listing is scoped to, validated with the same rules as an entry
 * name. It round-trips through the client, so it is attacker-influenced even
 * though this module is what produced it.
 */
function normalizePrefix(raw: string | undefined): string {
  if (!raw) return "";
  const normalized = normalizeEntryName(raw);
  if ("path" in normalized) return normalized.path;
  if ("root" in normalized) return "";
  throw new Error(`无法识别的压缩包内路径：${normalized.reason}`);
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_END_RECORD_SIZE = 22;
const ZIP_MAX_COMMENT = 0xffff;
/** The count/offset sentinels that mean "the real value is in the zip64 records". */
const ZIP_SENTINEL_ENTRIES = 0xffff;
const ZIP_SENTINEL_32 = 0xffffffff;

/** The three failures this module names for a zip, so a wrapper cannot invent others. */
const ZIP_UNREADABLE = "这不是可识别的 ZIP 压缩包（缺少中央目录结束记录，文件可能已截断）。";
/**
 * The names yauzl itself refuses while walking the directory.
 *
 * A hostile entry name (an absolute path, a `..` component, a backslash, a drive
 * letter) makes the parser raise instead of handing the entry over, so the
 * policy layer never sees it. The refusal still has to be *this* module's — the
 * archive is refused because the entry is unsafe, not because the container is
 * unreadable — so those two errors are told apart by the shape yauzl gives them.
 */
const ZIP_UNSAFE_NAME_PATTERN = /(?:invalid relative path|absolute path|invalid characters in (?:file)?[Nn]ame)[^:]*:\s*(.+)$/u;
const ZIP_DIRECTORY_CORRUPT = "ZIP 中央目录已损坏，条目记录不完整。";
const ZIP_ENTRY_CORRUPT = "ZIP 条目已损坏，无法解压。";

/**
 * ZIP: `yauzl` walks the container, this module keeps the policy (T16).
 *
 * The hand-rolled central-directory walk this replaced was a re-implementation
 * of a mature format — the class of code the plan forbids keeping for its own
 * sake. What stays here is what is *this* product's policy and not the format's:
 * the zip64 refusal keeps its named outcome, the entry ceiling still stops a
 * listing from building a million strings, every name still goes through
 * `nameVerdict`, the symlink refusal is unchanged, and the byte budget still
 * charges the bytes as they arrive rather than trusting the header.
 *
 * The parser's own failures are translated into the module's messages, because
 * those messages are what the panel shows and what the conformance corpus
 * asserts; yauzl's text is about a zip, not about this workspace.
 */
async function readZipEntries(buffer: Buffer): Promise<ArchiveContents> {
  const endRecord = findZipEndRecord(buffer);
  const declaredEntries = buffer.readUInt16LE(endRecord + 10);
  const directoryOffset = buffer.readUInt32LE(endRecord + 16);
  const directorySize = buffer.readUInt32LE(endRecord + 12);
  // The sentinels mean "look in the zip64 end-of-central-directory records".
  // yauzl could read those; this reader deliberately does not, so the outcome a
  // zip64 archive gets is the one it already had rather than a silent capability
  // change (T16's nonGoal: no new archive feature).
  if (
    declaredEntries === ZIP_SENTINEL_ENTRIES ||
    directoryOffset === ZIP_SENTINEL_32 ||
    directorySize === ZIP_SENTINEL_32
  ) {
    throw new Error("这是 ZIP64 压缩包，工作区面板暂不支持。");
  }
  if (directoryOffset + directorySize > buffer.length) {
    throw new Error("ZIP 中央目录越界，文件可能已损坏。");
  }

  let zip: ZipParserFile;
  try {
    zip = await loadZipParser().fromBufferPromise(buffer, {
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      autoClose: false,
    });
  } catch {
    throw new Error(ZIP_UNREADABLE);
  }

  const entries: ArchiveEntry[] = [];
  let walked = 0;
  let ended = false;
  try {
    while (walked < WORKSPACE_ARCHIVE_MAX_ENTRIES) {
      const record = await readNextZipEntry(zip);
      if (!record) {
        ended = true;
        break;
      }
      walked += 1;
      const entry = zipEntry(zip, record);
      if (entry) entries.push(entry);
    }
  } catch (error) {
    zip.close();
    const message = error instanceof Error ? error.message : "";
    // A refusal this module already named keeps its text.
    if (message === ZIP_ENTRY_CORRUPT) throw error;
    const unsafeName = ZIP_UNSAFE_NAME_PATTERN.exec(message)?.[1]?.trim();
    if (unsafeName) throw new Error(`压缩包中存在不安全的条目：${unsafeName}`);
    throw new Error(ZIP_DIRECTORY_CORRUPT);
  }

  return {
    entries,
    totalEntries: declaredEntries,
    truncated: !ended || walked < declaredEntries,
    close: () => zip.close(),
  };
}

/** One step of yauzl's lazy entry walk, as a promise; `undefined` ends it. */
function readNextZipEntry(zip: ZipParserFile): Promise<ZipParserEntry | undefined> {
  return new Promise((resolve, reject) => {
    const settle = <T>(value: T): T => {
      zip.removeListener("entry", onEntry);
      zip.removeListener("end", onEnd);
      zip.removeListener("error", onError);
      return value;
    };
    const onEntry = (entry: ZipParserEntry): void => resolve(settle(entry));
    const onEnd = (): void => resolve(settle(undefined));
    const onError = (error: Error): void => reject(settle(error));
    zip.on("entry", onEntry);
    zip.on("end", onEnd);
    zip.on("error", onError);
    zip.readEntry();
  });
}

/**
 * Scans backwards for the end-of-central-directory record.
 *
 * Scanned rather than read at a fixed offset because the record is followed by
 * an archive comment of up to 64 KiB. A candidate is accepted only when its own
 * comment length lands exactly on the end of the file, which is what stops the
 * same four signature bytes appearing inside compressed data from being read as
 * the real record — and what turns a truncated archive into a clear "this is
 * not a zip" instead of a wild offset.
 */
function findZipEndRecord(buffer: Buffer): number {
  const earliest = Math.max(0, buffer.length - (ZIP_END_RECORD_SIZE + ZIP_MAX_COMMENT));
  for (let offset = buffer.length - ZIP_END_RECORD_SIZE; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    if (offset + ZIP_END_RECORD_SIZE + buffer.readUInt16LE(offset + 20) === buffer.length) return offset;
  }
  throw new Error("这不是可识别的 ZIP 压缩包（缺少中央目录结束记录，文件可能已截断）。");
}

/**
 * One `yauzl` entry as this module's entry.
 *
 * The unix-mode read is the one the central directory carried — yauzl exposes
 * the same `externalFileAttributes`/`versionMadeBy` pair this module used to
 * decode by hand, so the directory test and the symlink refusal keep their
 * meaning exactly.
 */
function zipEntry(zip: ZipParserFile, record: ZipParserEntry): ArchiveEntry | undefined {
  const unixHost = record.versionMadeBy >> 8 === 3;
  const unixMode = unixHost ? (record.externalFileAttributes >>> 16) & 0xffff : undefined;
  const isDirectory =
    record.fileName.endsWith("/") || (unixMode !== undefined && (unixMode & 0o040000) !== 0);
  // Refuse the link rather than materialise one, because a symlink written into
  // a workspace is a write primitive pointing wherever the attacker likes.
  const symbolicLink = unixMode !== undefined && (unixMode & 0o170000) === 0o120000;
  const verdict = symbolicLink
    ? ({ reason: "条目是符号链接" } satisfies NameVerdict)
    : nameVerdict(normalizeEntryName(record.fileName), isDirectory);
  if (verdict.drop) return undefined;
  return {
    rawName: record.fileName,
    ...(verdict.path ? { path: verdict.path } : {}),
    isDirectory,
    declaredSize: record.uncompressedSize,
    compressedSize: record.compressedSize,
    ...(verdict.reason ? { unsafeReason: verdict.reason } : {}),
    read: (budget) => readZipEntryData(zip, record, isDirectory, budget),
  };
}

/**
 * Streams one entry's bytes, charging the shared budget as they arrive.
 *
 * The cap is enforced during the stream, not after it: a header claiming twelve
 * bytes and delivering a gigabyte is stopped while it is still arriving instead
 * of being allowed to allocate what it asked for. yauzl's own size validation
 * covers the mismatch between the declared and delivered lengths; both failures
 * leave the operation with this module's message.
 */
async function readZipEntryData(
  zip: ZipParserFile,
  record: ZipParserEntry,
  isDirectory: boolean,
  budget: ExpansionBudget,
): Promise<Buffer> {
  if (isDirectory) return Buffer.alloc(0);
  if (budget.remaining <= 0) throw new Error("压缩包展开后的体积过大，已拒绝读取。");
  try {
    const stream = await zip.openReadStreamPromise(record);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const bytes = chunk as Buffer;
      total += bytes.length;
      if (total > budget.remaining) {
        (stream as { destroy?: () => void }).destroy?.();
        throw new Error("压缩包展开后的体积过大，已拒绝读取。");
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("压缩包展开后")) throw error;
    throw new Error(ZIP_ENTRY_CORRUPT);
  }
}

// ---------------------------------------------------------------------------
// TAR
// ---------------------------------------------------------------------------

const TAR_BLOCK_SIZE = 512;
/** The two zero blocks a tar writes after its last member, ahead of its padding. */
const TAR_END_MARKER_BYTES = TAR_BLOCK_SIZE * 2;

/** The failures this module names for a tar, so a wrapper cannot invent others. */
const TAR_TRUNCATED = "tar 归档没有结束标记，文件可能已截断。";
const TAR_HEADER_CORRUPT = "tar 头部校验和不匹配，文件可能已损坏。";

async function readTarEntries(buffer: Buffer): Promise<ArchiveContents> {
  assertTarEndMarker(buffer);
  const entries: ArchiveEntry[] = [];
  let walked = 0;
  let truncated = false;
  let refusal: string | undefined;
  await new Promise<void>((resolve, reject) => {
    const parser = loadTarParser().t({
      // A warning is not noise here: `TAR_ENTRY_INVALID` is how the parser
      // reports a header it cannot trust, and skipping one silently would change
      // which members the archive is said to hold.
      onwarn: (warning) => {
        refusal ??= tarWarningRefusal(tarWarningCode(warning));
      },
      onentry: (record) => {
        if (walked >= WORKSPACE_ARCHIVE_MAX_ENTRIES) {
          truncated = true;
          // Drained, not buffered: the walk has to consume the member to reach
          // the next header, and skipping one costs no memory.
          record.resume();
          return;
        }
        walked += 1;
        const entry = tarEntry(record);
        if (entry) entries.push(entry);
        record.resume();
      },
    });
    parser.on("error", (error: Error) => reject(error));
    parser.on("end", () => resolve());
    parser.on("close", () => resolve());
    parser.end(buffer);
  });
  if (refusal) throw new Error(refusal);
  return { entries, totalEntries: entries.length, truncated };
}

/**
 * The end-of-archive marker, checked before the walk.
 *
 * `tar` reports a truncated archive by stopping rather than by raising, so this
 * is what turns a silent short read into the refusal the caller's contract
 * promises: a conforming archive is block-aligned and ends with two zero blocks.
 */
function assertTarEndMarker(buffer: Buffer): void {
  if (buffer.length % TAR_BLOCK_SIZE !== 0) throw new Error(TAR_TRUNCATED);
  const tail = buffer.subarray(buffer.length - TAR_END_MARKER_BYTES);
  if (tail.length !== TAR_END_MARKER_BYTES || tail.some((byte) => byte !== 0)) {
    throw new Error(TAR_TRUNCATED);
  }
}

/** The warning's own code, whichever field the parser put it in. */
function tarWarningCode(warning: TarParserWarning): string | undefined {
  const text = typeof warning === "string" ? warning : (warning.code ?? warning.message);
  return typeof text === "string" && text.startsWith("TAR_") ? text : undefined;
}

/** The parser warnings that mean the container cannot be trusted, by name. */
function tarWarningRefusal(code: string | undefined): string | undefined {
  if (code === "TAR_BAD_ARCHIVE") return "这不是可识别的 tar 归档。";
  if (code === "TAR_ENTRY_INVALID") return TAR_HEADER_CORRUPT;
  if (code === "TAR_ENTRY_ERROR") return "tar 条目数据不完整，文件可能已损坏。";
  if (code === "TAR_ENTRY_UNSUPPORTED") return "tar 归档使用了不支持的条目类型。";
  return undefined;
}

/** One parser entry as this module's entry; the policy is applied here. */
function tarEntry(record: TarParserRecord): ArchiveEntry | undefined {
  const isDirectory =
    record.type === "Directory" || record.type === "GNUDumpDir" || record.path.endsWith("/");
  const regular =
    record.type === "File" || record.type === "OldFile" || record.type === "ContiguousFile";
  if (!isDirectory && !regular) {
    // The tar analogue of the zip symlink refusal, and it covers more: hard
    // links, devices and FIFOs are all refused, because none of them is
    // something this panel has any business creating in a workspace.
    return {
      rawName: record.path,
      isDirectory: false,
      declaredSize: record.size,
      compressedSize: record.size,
      unsafeReason: tarTypeRefusal(record.type),
    };
  }
  const verdict = nameVerdict(normalizeEntryName(record.path), isDirectory);
  if (verdict.drop) return undefined;
  return {
    rawName: record.path,
    ...(verdict.path ? { path: verdict.path } : {}),
    isDirectory,
    declaredSize: record.size,
    // A tar member is stored as-is, so its "compressed" size is its own length;
    // a `.tar.gz` is capped as a whole buffer at gunzip time instead.
    compressedSize: record.size,
    ...(verdict.reason ? { unsafeReason: verdict.reason } : {}),
  };
}

function tarTypeRefusal(type: string): string {
  if (type === "Link") return "条目是硬链接";
  if (type === "SymbolicLink") return "条目是符号链接";
  if (type === "CharacterDevice" || type === "BlockDevice") return "条目是设备文件";
  if (type === "FIFO") return "条目是 FIFO";
  return `条目类型不受支持（${JSON.stringify(type)}）`;
}

// ---------------------------------------------------------------------------
// The tar parser
// ---------------------------------------------------------------------------

/**
 * `tar`, loaded through `require` and typed here (T16).
 *
 * Only the parser stream is used, so the shape below is what this module calls
 * rather than the library's whole option surface.
 */
type TarParserRecord = NodeJS.ReadableStream & {
  readonly path: string;
  readonly type: string;
  readonly size: number;
};

/**
 * tar's warning surface is inconsistent: some paths hand the code over as an
 * object, others as the bare code string, so both are read.
 */
type TarParserWarning = string | { readonly code?: string; readonly message?: string };

type TarParserStream = {
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "end" | "close", listener: () => void): void;
  end(buffer: Buffer): void;
};

type TarParserModule = {
  t(options: {
    readonly onentry: (record: TarParserRecord) => void;
    readonly onwarn: (warning: TarParserWarning) => void;
  }): TarParserStream;
};

function loadTarParser(): TarParserModule {
  return require("tar") as TarParserModule;
}

/**
 * The extraction pass for a tar.
 *
 * `tar` cannot re-open an entry after its walk, so the bytes are written here —
 * a second pass over the same in-memory buffer, under the validation the first
 * pass already made. A member is in flight only while it is being written, so
 * the peak is one member rather than the archive; buffering every member would
 * double what the module already holds, and the archive's own cap is one a
 * hostile input can reach.
 */
async function writeTarSelection(
  buffer: Buffer,
  selected: readonly ArchiveEntry[],
  prefix: string,
  root: string,
  budget: ExpansionBudget,
): Promise<number> {
  const wanted = new Set<string>();
  for (const entry of selected) {
    if (entry.path && !entry.isDirectory) wanted.add(entry.path);
  }
  let written = 0;
  let failure: Error | undefined;
  await new Promise<void>((resolve, reject) => {
    const parser = loadTarParser().t({
      onwarn: (warning) => {
        const refusal = tarWarningRefusal(tarWarningCode(warning));
        if (refusal) failure ??= new Error(refusal);
      },
      onentry: (record) => {
        const entry = tarEntry(record);
        if (!entry || entry.isDirectory || !entry.path || !wanted.has(entry.path)) {
          record.resume();
          return;
        }
        const target = resolveEntryPath(root, entryPathUnderPrefix(entry, prefix));
        // The parser waits for this member to be consumed before it emits the
        // next one, so the writes stay sequential without a queue of their own.
        void writeTarMember(record, root, target, budget).then(
          () => {
            written += 1;
          },
          (error: Error) => {
            failure ??= error;
            record.resume();
          },
        );
      },
    });
    parser.on("error", (error: Error) => reject(error));
    parser.on("end", () => resolve());
    parser.on("close", () => resolve());
    parser.end(buffer);
  });
  if (failure) throw failure;
  return written;
}

/**
 * Streams one member to its destination.
 *
 * The file is created with `wx` before a byte is written, so an archive can
 * never clobber a file already in the workspace, and it is unlinked again if the
 * stream fails — the invariant the buffered path keeps by writing once, kept
 * here by leaving nothing behind.
 */
async function writeTarMember(
  record: TarParserRecord,
  root: string,
  target: string,
  budget: ExpansionBudget,
): Promise<void> {
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const resolvedParent = await realpath(parent);
  if (resolvedParent !== root && !resolvedParent.startsWith(rootPrefix(root))) {
    throw new Error("压缩包条目试图通过符号链接写出解压目录。");
  }
  const file = path.join(resolvedParent, path.basename(target));
  const handle = await open(file, "wx");
  const declared = Math.max(record.size, 1);
  let total = 0;
  try {
    for await (const chunk of record) {
      const bytes = chunk as Buffer;
      total += bytes.length;
      // Charged as the bytes arrive, against what is left of the shared budget,
      // so a header that lies about its size is stopped while it is still
      // arriving rather than after it has been held.
      if (total > budget.remaining) throw new Error("压缩包展开后的体积过大，已拒绝解压。");
      if (total / declared > WORKSPACE_ARCHIVE_MAX_EXPANSION_RATIO) {
        throw new Error("压缩包中存在异常膨胀的条目，已拒绝解压。");
      }
      await handle.write(bytes);
    }
    budget.remaining -= total;
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(file).catch(() => undefined);
    throw error;
  }
  await handle.close();
}


// ---------------------------------------------------------------------------
// Dispatch, listing and extraction
// ---------------------------------------------------------------------------

async function readArchive(archivePath: string): Promise<{ readonly format: ArchiveFormat; readonly buffer: Buffer }> {
  const selected = archiveFormatFor(archivePath);
  if (!("format" in selected)) throw new Error(selected.error);
  const raw = await readFile(archivePath);
  if (selected.format !== "tar.gz") return { format: selected.format, buffer: raw };
  try {
    return {
      format: selected.format,
      // `maxOutputLength` on the whole-buffer gunzip: a 200 MiB `.tgz` can
      // expand well past the budget, and it is decompressed before a single tar
      // header has been parsed, so this is the only ceiling standing there.
      buffer: gunzipSync(raw, { maxOutputLength: WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES }),
    };
  } catch (error) {
    if (isBufferTooLarge(error)) throw new Error("压缩包展开后的体积过大，已拒绝读取。");
    throw new Error("gzip 数据已损坏，无法解压。");
  }
}

async function readContents(buffer: Buffer, format: ArchiveFormat): Promise<ArchiveContents> {
  if (format === "zip") {
    if (buffer.length < ZIP_END_RECORD_SIZE) throw new Error("这个 ZIP 文件太短或已截断。");
    return readZipEntries(buffer);
  }
  if (buffer.length < TAR_BLOCK_SIZE * 2) throw new Error("这个 tar 文件太短或已截断。");
  return readTarEntries(buffer);
}

/**
 * The rows for one level, with directories synthesised from their children.
 *
 * A zip or tar routinely stores only file entries and leaves the directories
 * implied, so a listing that reported only what is literally present would show
 * an empty level for a directory full of files. A synthesised directory row
 * carries the same `path` an explicit entry would, with no trailing slash: the
 * name alone distinguishes a directory, and the view navigates by name.
 *
 * `shouldStripArchiveRoot` in `remote/archive.ts` is deliberately *not* ported
 * here. It strips a single top-level directory because a skill install needs
 * the path *inside* the repository, whereas a preview has to name what the
 * archive actually contains — silently dropping the root a user is looking at
 * would make this panel disagree with every other zip tool.
 */
function listOneLevel(
  contents: ArchiveContents,
  prefix: string,
): { readonly entries: readonly WebuiArchiveEntry[]; readonly truncated: boolean } {
  const scope = prefix ? `${prefix}/` : "";
  const directories = new Map<string, WebuiArchiveEntry>();
  const files: WebuiArchiveEntry[] = [];
  let refused = 0;

  for (const entry of contents.entries) {
    if (entry.unsafeReason || !entry.path) {
      // Not named: the view renders only what this call is willing to write, so
      // an entry that extraction would refuse is not advertised first.
      refused += 1;
      continue;
    }
    if (!entry.path.startsWith(scope) || entry.path.length === scope.length) continue;
    const remainder = entry.path.slice(scope.length);
    const slash = remainder.indexOf("/");
    if (slash !== -1) {
      const name = remainder.slice(0, slash);
      if (!directories.has(name)) {
        directories.set(name, { path: `${scope}${name}`, name, isDirectory: true });
      }
      continue;
    }
    if (entry.isDirectory) {
      if (!directories.has(remainder)) {
        directories.set(remainder, { path: remainder, name: remainder, isDirectory: true });
      }
      continue;
    }
    files.push({ path: remainder, name: remainder, isDirectory: false, size: entry.declaredSize });
  }

  const byName = (a: WebuiArchiveEntry, b: WebuiArchiveEntry): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const ordered = [...[...directories.values()].sort(byName), ...files.sort(byName)];
  const entries = ordered.slice(0, WORKSPACE_ARCHIVE_MAX_LISTED_ENTRIES);
  return { entries, truncated: refused > 0 || ordered.length > entries.length };
}

/** The entries an extraction writes, scoped to the prefix. */
function selectForExtraction(contents: ArchiveContents, prefix: string): readonly ArchiveEntry[] {
  if (!prefix) return contents.entries;
  const scope = `${prefix}/`;
  // An entry with no path is one the reader refused, and it is selected
  // regardless of the prefix so the pre-flight refuses the whole archive for it.
  // Scoping it away would make extracting a subdirectory quietly skip a hostile
  // entry that extracting the root refuses.
  return contents.entries.filter(
    (entry) => entry.path === undefined || entry.path === prefix || entry.path.startsWith(scope),
  );
}

/**
 * An entry's path relative to the prefix being extracted, so extracting `src`
 * into `dest` writes `dest/index.ts` rather than `dest/src/index.ts`.
 */
function entryPathUnderPrefix(entry: ArchiveEntry, prefix: string): string {
  if (!entry.path) throw new Error(`压缩包中存在不安全的条目：${entry.unsafeReason ?? entry.rawName}`);
  if (!prefix) return entry.path;
  if (entry.path === prefix) return path.posix.basename(entry.path);
  return entry.path.slice(prefix.length + 1);
}

/** The extraction pass for a zip: the walk already happened, so each entry is read in turn. */
async function writeZipSelection(
  root: string,
  selected: readonly ArchiveEntry[],
  prefix: string,
  budget: ExpansionBudget,
): Promise<number> {
  let writtenFiles = 0;
  for (const entry of selected) {
    if (entry.isDirectory) continue;
    const target = resolveEntryPath(root, entryPathUnderPrefix(entry, prefix));
    await writeExtractedFile(root, target, entry, budget);
    writtenFiles += 1;
  }
  return writtenFiles;
}

/**
 * Writes one entry, re-validating its parent directory against the extraction
 * root first.
 *
 * The parent is re-resolved with `realpath` because `mkdir -p` through a
 * symlink left behind by an earlier entry (or by the user) would otherwise be
 * written *through*: the name check passes, the filesystem resolves elsewhere.
 */
async function writeExtractedFile(
  root: string,
  target: string,
  entry: ArchiveEntry,
  budget: ExpansionBudget,
): Promise<void> {
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const resolvedParent = await realpath(parent);
  if (resolvedParent !== root && !resolvedParent.startsWith(rootPrefix(root))) {
    throw new Error("压缩包条目试图通过符号链接写出解压目录。");
  }
  const data = await readEntryBounded(entry, budget);
  // `wx`: refuse to clobber, as the sibling extractor does. An archive the user
  // did not write must never be able to overwrite a file already in their
  // workspace, and a conflict is far better surfaced than silently resolved in
  // the archive's favour.
  await writeFile(path.join(resolvedParent, path.basename(target)), data, { flag: "wx" });
}

/**
 * Reads an entry's bytes, charging both the shared total budget and the
 * per-entry expansion ratio.
 *
 * The ratio is measured against the bytes that actually arrived, not the
 * declared size, so the classic shape — a tiny member that inflates to
 * gigabytes — is caught even when the header is honest about the total.
 */
function isBufferTooLarge(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE";
}

async function readEntryBounded(entry: ArchiveEntry, budget: ExpansionBudget): Promise<Buffer> {
  const read = entry.read;
  if (!read) throw new Error(`压缩包条目无法读取（${entry.rawName}）。`);
  const data = await read.call(entry, budget);
  if (data.length > budget.remaining) {
    throw new Error("压缩包展开后的体积过大，已拒绝解压。");
  }
  const compressed = Math.max(entry.compressedSize, 1);
  if (data.length / compressed > WORKSPACE_ARCHIVE_MAX_EXPANSION_RATIO) {
    throw new Error("压缩包中存在异常膨胀的条目，已拒绝解压。");
  }
  budget.remaining -= data.length;
  return data;
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}
