import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { currentTx } from "../db/client.js";
import { LineBotRepository } from "./line-bot.repository.js";
import { LineGroupRepository, type LineGroupRow } from "./line-group.repository.js";
import { LineApiClient } from "./line-api.client.js";
import type { LineGroupPatchDto } from "./dto/line-bot.dto.js";

@Injectable()
export class LineGroupService {
  constructor(
    private readonly botRepo: LineBotRepository,
    private readonly groupRepo: LineGroupRepository,
    private readonly lineApi: LineApiClient,
  ) {}

  async listGroupsByBot(botId: string): Promise<LineGroupRow[]> {
    const tx = currentTx();
    // 先確認 bot 存在（RLS 會擋跨租戶）
    const bot = await this.botRepo.getById(tx, botId);
    if (!bot) throw new NotFoundException("找不到 bot");
    return this.groupRepo.listByBot(tx, botId);
  }

  async patchGroup(groupRegistryId: string, patch: LineGroupPatchDto): Promise<LineGroupRow> {
    const tx = currentTx();
    const existing = await this.groupRepo.getById(tx, groupRegistryId);
    if (!existing) throw new NotFoundException("找不到群組");
    await this.groupRepo.patchAssignment(tx, groupRegistryId, patch);
    const updated = await this.groupRepo.getById(tx, groupRegistryId);
    if (!updated) throw new Error("剛更新的群組找不到");
    return updated;
  }

  // 手動觸發拉群名稱（LINE API）
  async probeDisplayName(groupRegistryId: string): Promise<{ displayName: string | null }> {
    const tx = currentTx();
    const group = await this.groupRepo.getById(tx, groupRegistryId);
    if (!group) throw new NotFoundException("找不到群組");
    const bot = await this.botRepo.getByIdWithSecrets(tx, group.botId);
    if (!bot) throw new BadRequestException("找不到對應 bot");
    const summary = await this.lineApi.getGroupSummary(bot.channelAccessToken, group.groupId);
    if (!summary) return { displayName: null };
    await this.groupRepo.updateDisplayName(tx, {
      botId: group.botId,
      groupId: group.groupId,
      displayName: summary.groupName,
    });
    return { displayName: summary.groupName };
  }
}
