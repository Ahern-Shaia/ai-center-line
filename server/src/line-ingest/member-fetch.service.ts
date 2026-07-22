import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import PQueue from "p-queue";
import { withSystemTx } from "../db/client.js";
import { LineApiClient } from "./line-api.client.js";
import { LineMemberRepository } from "./line-member.repository.js";

/**
 * LINE 群組成員 profile 取回服務
 * · webhook 收訊時 fire-and-forget · 已有 cache 就 skip
 * · p-queue concurrency 5 · 保護 LINE API rate limit
 *
 * FMEA:
 * - LINE API quota (1000 free/月) → dedup by (bot, group, user) 避重複拉
 * - user 未在群 consent → 400 · 記 fetch_error · retry job (v2) 可掃
 * - LINE API 掛 → recordFailure 記錯 · 分析報表 fallback 用 pseudonym
 */
@Injectable()
export class MemberFetchService implements OnModuleInit {
  private readonly logger = new Logger(MemberFetchService.name);
  private queue!: PQueue;

  constructor(
    private readonly api: LineApiClient,
    private readonly memberRepo: LineMemberRepository,
  ) {}

  onModuleInit(): void {
    this.queue = new PQueue({ concurrency: 5 });
  }

  /**
   * fire-and-forget · webhook 就緒即 push queue · 不 await
   * 已在 line_member 有 row 就 skip API call
   */
  enqueue(args: {
    tenantId: string;
    botId: string;
    groupId: string;
    userId: string;
    accessToken: string;
  }): void {
    void this.queue.add(() => this.fetchAndCache(args).catch((err) => {
      this.logger.error(`member fetch unhandled · userId=${args.userId.slice(-6)} · ${(err as Error).message}`);
    }));
  }

  private async fetchAndCache(args: {
    tenantId: string;
    botId: string;
    groupId: string;
    userId: string;
    accessToken: string;
  }): Promise<void> {
    // 先查 cache · 已有就 skip (避免每則訊息都打 LINE API)
    const already = await withSystemTx((tx) =>
      this.memberRepo.exists(tx, args.botId, args.groupId, args.userId));
    if (already) return;

    const result = await this.api.getGroupMemberProfile(
      args.accessToken, args.groupId, args.userId,
    );

    if ("error" in result) {
      await withSystemTx((tx) => this.memberRepo.recordFailure(tx, {
        tenantId: args.tenantId,
        botId: args.botId,
        groupId: args.groupId,
        userId: args.userId,
        error: result.error,
      }));
      return;
    }

    await withSystemTx((tx) => this.memberRepo.upsert(tx, {
      tenantId: args.tenantId,
      botId: args.botId,
      groupId: args.groupId,
      userId: args.userId,
      displayName: result.displayName,
      pictureUrl: result.pictureUrl ?? null,
    }));
    this.logger.log(`member fetched · groupId=${args.groupId.slice(0, 12)} · displayName="${result.displayName}"`);
  }
}
