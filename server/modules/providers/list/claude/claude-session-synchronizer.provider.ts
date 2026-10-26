import os from 'node:os';
import path from 'node:path';
import { open, readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import {
  buildLookupMap,
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

/** 尾部读取块大小：一条普通 transcript 行远小于该值，通常一次即可命中。 */
const ACTIVITY_TAIL_CHUNK_BYTES = 64 * 1024;
/** 尾部读取上限：避免超长 tool result 单行导致无限回溯。 */
const ACTIVITY_TAIL_MAX_BYTES = 1024 * 1024;

/**
 * Session indexer for Claude transcript artifacts.
 */
export class ClaudeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'claude' as const;
  private readonly claudeHome = path.join(os.homedir(), '.claude');

  /**
   * Returns true when a JSONL file is a subagent transcript or tool result
   * rather than a top-level session.
   *
   * Claude stores subagent transcripts under a `subagents/` directory and
   * tool results under a `tool-results/` directory, e.g.
   * `~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.jsonl`.
   * Those files repeat the parent session's `sessionId`, so indexing them as
   * standalone sessions overwrites the parent row's `jsonl_path` and corrupts
   * the main session record. The recursive scan in `synchronize()` reaches
   * them, so both entry points must skip them.
   */
  private isSubagentTranscript(filePath: string): boolean {
    const pathParts = path.normalize(filePath).split(path.sep);
    return pathParts.includes('subagents') || pathParts.includes('tool-results');
  }

  /**
   * Scans ~/.claude/projects and upserts discovered sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const nameMap = await buildLookupMap(path.join(this.claudeHome, 'history.jsonl'), 'sessionId', 'display');
    const files = await findFilesRecursivelyCreatedAfter(
      path.join(this.claudeHome, 'projects'),
      '.jsonl',
      since ?? null
    );

    let processed = 0;
    for (const filePath of files) {
      if (this.isSubagentTranscript(filePath)) {
        continue;
      }

      const parsed = await this.processSessionFile(filePath, nameMap);
      if (!parsed) {
        continue;
      }

      const timestamps = await readFileTimestamps(filePath);
      // 侧边栏的“最近活跃”和归档自动恢复都使用 updated_at，因此它必须来自
      // 最后一条真实对话事件，而不是文件 mtime。Claude Code 会在空闲时原地
      // 重写 mode / permission-mode / atis-latch 等元数据行，mtime 变化并不
      // 代表产生了新消息。只有解析不到任何对话事件时才回退到 mtime。
      const lastActivityAt = await this.extractLastActivityTimestamp(filePath);
      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        parsed.projectPath,
        parsed.sessionName,
        timestamps.createdAt,
        lastActivityAt ?? timestamps.updatedAt,
        filePath
      );
      processed += 1;
    }

    return processed;
  }

  /**
   * Parses and upserts one Claude session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }
    if (this.isSubagentTranscript(filePath)) {
      return null;
    }

    const nameMap = await buildLookupMap(path.join(this.claudeHome, 'history.jsonl'), 'sessionId', 'display');
    const parsed = await this.processSessionFile(filePath, nameMap);
    if (!parsed) {
      return null;
    }

    const timestamps = await readFileTimestamps(filePath);
    const lastActivityAt = await this.extractLastActivityTimestamp(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      lastActivityAt ?? timestamps.updatedAt,
      filePath
    );
  }

  /**
   * 从 transcript 尾部倒序读取最后一条真实对话事件的时间戳。
   *
   * Claude Code 会往会话文件里混写 mode / permission-mode / atis-latch /
   * api-request* / file-history-* 等元数据行，这些行没有 timestamp，且可能在
   * 没有任何新消息时被原地重写。若用文件 mtime 当作会话活跃时间，就会把这种
   * 维护性写入误判成“会话刚刚活跃”，既点亮侧边栏绿点，也会解除会话归档。
   *
   * 只认可带 timestamp 的 user / assistant 事件；子代理（isSidechain）事件不
   * 属于当前对话主线，跳过。找不到时返回 undefined，由调用方回退到 mtime。
   */
  private async extractLastActivityTimestamp(filePath: string): Promise<string | undefined> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    try {
      handle = await open(filePath, 'r');
      const { size } = await handle.stat();
      let cursor = size;
      let consumedBytes = 0;
      // 本轮读取块的首行可能是被截断的半行，留到下一轮拼接到前面。
      let partialFirstLine = '';

      while (cursor > 0 && consumedBytes < ACTIVITY_TAIL_MAX_BYTES) {
        const length = Math.min(ACTIVITY_TAIL_CHUNK_BYTES, cursor);
        const start = cursor - length;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);

        const text = buffer.subarray(0, bytesRead).toString('utf8') + partialFirstLine;
        const lines = text.split('\n');
        // 文件头部的那一行是完整的；其余情况第 0 行是半行，不能解析。
        const firstCompleteIndex = start === 0 ? 0 : 1;

        for (let index = lines.length - 1; index >= firstCompleteIndex; index -= 1) {
          const timestamp = this.readActivityTimestampFromLine(lines[index]);
          if (timestamp) {
            return timestamp;
          }
        }

        partialFirstLine = start === 0 ? '' : lines[0] ?? '';
        // 单行已经超过上限，继续向前读也无法补全。
        if (partialFirstLine.length > ACTIVITY_TAIL_MAX_BYTES) {
          return undefined;
        }

        consumedBytes += bytesRead;
        cursor = start;
      }
    } catch {
      // 读取失败交给调用方回退到 mtime，不能因此中断会话索引。
    } finally {
      await handle?.close().catch(() => undefined);
    }

    return undefined;
  }

  /** 解析一行 transcript，返回其中真实对话事件的时间戳。 */
  private readActivityTimestampFromLine(line: string): string | undefined {
    const trimmed = line.trim();
    if (!trimmed) {
      return undefined;
    }

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return undefined;
    }

    if (entry.isSidechain === true) {
      return undefined;
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') {
      return undefined;
    }

    return typeof entry.timestamp === 'string' && entry.timestamp ? entry.timestamp : undefined;
  }

  /**
   * Extracts session metadata from one Claude JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>
  ): Promise<ParsedSession | null> {
    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
      const projectPath = typeof data.cwd === 'string' ? data.cwd : undefined;

      if (!sessionId || !projectPath) {
        return null;
      }

      return {
        sessionId,
        projectPath,
      };
    });

    if (!parsed) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;
    if (existingSessionName && existingSessionName !== 'Untitled Claude Session') {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSessionName, 'Untitled Claude Session'),
      };
    }

    let sessionName = await this.extractSessionTitle(filePath, parsed.sessionId);
    if (!sessionName) {
      sessionName = nameMap.get(parsed.sessionId);
    }

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, 'Untitled Claude Session'),
    };
  }

  /**
   * Returns the best available title for one session from its transcript.
   *
   * Scans forward keeping the last match of each event type, then prefers
   * `custom-title` (a manual `/rename`) over `ai-title` over `last-prompt`.
   * Claude writes `custom-title` immediately before `ai-title`, so a reverse
   * scan that returns its first hit would always lose the manual rename.
   *
   * Returns undefined on a missing or unreadable file so sync can continue.
   */
  private async extractSessionTitle(
    filePath: string,
    sessionId: string
  ): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      let foundCustomTitle: string | undefined;
      let foundAiTitle: string | undefined;
      let foundLastPrompt: string | undefined;

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]?.trim();
        if (!line) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const data = parsed as Record<string, unknown>;
        const eventType = typeof data.type === 'string' ? data.type : undefined;
        const eventSessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;

        if (eventSessionId !== sessionId) {
          continue;
        }

        if (eventType === 'custom-title') {
          const title = typeof data.customTitle === 'string' ? data.customTitle : undefined;
          if (title?.trim()) {
            foundCustomTitle = title;
          }
        } else if (eventType === 'ai-title') {
          const title = typeof data.aiTitle === 'string' ? data.aiTitle : undefined;
          if (title?.trim()) {
            foundAiTitle = title;
          }
        } else if (eventType === 'last-prompt') {
          const prompt = typeof data.lastPrompt === 'string' ? data.lastPrompt : undefined;
          if (prompt?.trim()) {
            foundLastPrompt = prompt;
          }
        }
      }

      return foundCustomTitle || foundAiTitle || foundLastPrompt;
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }
}
