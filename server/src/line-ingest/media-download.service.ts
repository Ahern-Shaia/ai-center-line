import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import PQueue from "p-queue";
import { withSystemTx } from "../db/client.js";
import { LineMessageRepository } from "./line-message.repository.js";
import { LineMediaRepository } from "./line-media.repository.js";
import { MediaStorageService } from "./media-storage.service.js";

/**
 * 媒體下載服務 · webhook 收到 image/video/audio/file 時 fire-and-forget
 * · in-process p-queue 併發上限 5 · 不 block webhook 200 回應（LINE 10s 內回不了會 disable webhook）
 * · 失敗記 download_error · aiproot 手動 retry
 *
 * FMEA:
 * - M1 (LINE URL 24hr 過期) → 立即下載 · 若延遲觸發只能記 error
 * - M2 (媒體 > 100MB) → 目前 buffer to memory · v2 改 stream to S3
 * - M3 (S3 credentials 失效) → put throws · 記 error · alarm 由 metric 觸發 (M4)
 * - M4 (同 messageId 二次) → line_media UNIQUE (message_id) DO UPDATE
 * - M5 (併發 100 個下載) → p-queue concurrency 5 保護
 */
@Injectable()
export class MediaDownloadService implements OnModuleInit {
  private readonly logger = new Logger(MediaDownloadService.name);
  private queue!: PQueue;

  constructor(
    private readonly storage: MediaStorageService,
    private readonly messageRepo: LineMessageRepository,
    private readonly mediaRepo: LineMediaRepository,
  ) {}

  onModuleInit(): void {
    this.queue = new PQueue({ concurrency: 5 });
  }

  /**
   * fire-and-forget · webhook 就緒即 push queue · 不 await
   * 呼叫者不需 catch · 內部處理錯誤
   */
  enqueue(args: {
    messageId: string;
    tenantId: string;
    mediaType: string;
    accessToken: string;
    originalFilename: string | null;
  }): void {
    void this.queue.add(() => this.downloadAndStore(args).catch((err) => {
      this.logger.error(`媒體下載 unhandled · messageId=${args.messageId} · ${(err as Error).message}`);
    }));
  }

  private async downloadAndStore(args: {
    messageId: string;
    tenantId: string;
    mediaType: string;
    accessToken: string;
    originalFilename: string | null;
  }): Promise<void> {
    const { messageId, tenantId, mediaType, accessToken, originalFilename } = args;

    // 未設定 S3 · 只記 metadata + error 供之後 backfill
    if (!this.storage.enabled) {
      await this.recordFailure(messageId, tenantId, mediaType, originalFilename, "S3 未設定");
      return;
    }

    let buf: Buffer;
    let contentType: string | null = null;
    try {
      const url = `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        await this.recordFailure(messageId, tenantId, mediaType, originalFilename, `HTTP ${res.status}`);
        return;
      }
      contentType = res.headers.get("content-type");
      buf = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      await this.recordFailure(messageId, tenantId, mediaType, originalFilename, `fetch: ${(err as Error).message}`);
      return;
    }

    const sha256 = createHash("sha256").update(buf).digest("hex");
    const storageKey = this.storage.makeKey(tenantId, messageId);

    try {
      await this.storage.put(storageKey, buf, contentType);
    } catch (err) {
      await this.recordFailure(messageId, tenantId, mediaType, originalFilename, `S3 put: ${(err as Error).message}`);
      return;
    }

    // 成功 · line_media insert + line_message.media_id backfill
    await withSystemTx(async (tx) => {
      const { mediaId } = await this.mediaRepo.insert(tx, {
        tenantId,
        messageId,
        mediaType,
        storageBackend: "s3",
        storageKey,
        contentType,
        sizeBytes: buf.length,
        originalFilename,
        sha256,
        downloadError: null,
      });
      await this.messageRepo.attachMedia(tx, messageId, mediaId);
    });
  }

  private async recordFailure(
    messageId: string,
    tenantId: string,
    mediaType: string,
    originalFilename: string | null,
    reason: string,
  ): Promise<void> {
    this.logger.warn(`媒體下載失敗 · messageId=${messageId} · reason=${reason}`);
    try {
      await withSystemTx(async (tx) => {
        await this.mediaRepo.insert(tx, {
          tenantId,
          messageId,
          mediaType,
          storageBackend: "none",
          storageKey: null,
          contentType: null,
          sizeBytes: null,
          originalFilename,
          sha256: null,
          downloadError: reason,
        });
      });
    } catch (err) {
      this.logger.error(`recordFailure 也炸 · messageId=${messageId} · ${(err as Error).message}`);
    }
  }
}
