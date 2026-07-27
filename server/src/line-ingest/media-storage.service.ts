import { Injectable, Logger } from "@nestjs/common";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

/**
 * S3-相容 客戶端 · 預設 Cloudflare R2 (OQ-CAR-2 v0.3 裁定 · 省 egress)
 *
 * env (R2 · 推薦)：
 *   S3_ENDPOINT         — https://<account_id>.r2.cloudflarestorage.com
 *   S3_BUCKET           — bucket name (必要)
 *   S3_REGION           — "auto" (R2 用 auto · S3 用 ap-northeast-1)
 *   S3_ACCESS_KEY_ID    — R2 API token access key
 *   S3_SECRET_ACCESS_KEY — R2 API token secret
 *
 * env (AWS S3 · 備選)：
 *   S3_ENDPOINT         — 不設 (走 AWS 官)
 *   S3_REGION           — e.g. "ap-northeast-1" (東京 · 對台灣延遲低)
 *   其餘同上
 *
 * storage_key 慣例：`<tenant_id>/<messageId>` · 避跨 tenant 撞
 */
@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor() {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    const endpoint = process.env.S3_ENDPOINT;                    // custom (R2)

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        "S3 未設定 (S3_BUCKET / S3_REGION / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY) · 媒體下載會全走 fallback (line_media 只留 metadata)",
      );
      this.client = null;
      this.bucket = "";
      return;
    }
    this.client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      endpoint,                                                  // undefined = 官 S3
      forcePathStyle: !!endpoint,                                // R2 需 path style
    });
    this.bucket = bucket;
    this.logger.log(`S3 init · bucket=${bucket} · region=${region}${endpoint ? ` · endpoint=${endpoint}` : ""}`);
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  makeKey(tenantId: string, messageId: string): string {
    return `${tenantId}/${messageId}`;
  }

  async put(key: string, body: Buffer, contentType: string | null): Promise<void> {
    if (!this.client) throw new Error("S3 未設定 · 呼叫前需 check enabled");
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType ?? "application/octet-stream",
    }));
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 抹掉物件 · 誤傳的個資照片要真的不見（media-and-vision.md §7）
   * S3 刪不存在的 key 不算錯，所以重跑清除排程是安全的。
   */
  async remove(key: string): Promise<void> {
    if (!this.client) throw new Error("S3 未設定 · 呼叫前需 check enabled");
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async get(key: string): Promise<Buffer | null> {
    if (!this.client) return null;
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      const chunks: Buffer[] = [];
      const stream = res.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
}
