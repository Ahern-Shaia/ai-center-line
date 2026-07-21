import { Injectable, Logger } from "@nestjs/common";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

/**
 * S3 客戶端 · 支援 AWS S3 官方 endpoint (預設)
 *
 * env:
 *   S3_BUCKET           — bucket name (必要)
 *   S3_REGION           — e.g. "ap-northeast-1" (東京 · 對台灣延遲低) (必要)
 *   S3_ACCESS_KEY_ID    — IAM key (必要)
 *   S3_SECRET_ACCESS_KEY — IAM secret (必要)
 *   S3_ENDPOINT         — custom endpoint (optional · Cloudflare R2 用)
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
