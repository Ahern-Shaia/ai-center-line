import { Injectable, Logger, Optional } from "@nestjs/common";

// notify 多租戶登錄。
// 設計文件：docs/modules/notify-multi-tenant.md §4
// 決策：per-tenant NOTIFY_WEBHOOK_SECRET_<T> = secret 兼識別（OQ-NMT-1 A）
// 台灣福祉沿用無後綴的舊 env 當 default fallback（OQ-NMT-4 B）→ 部署後行為不變

export interface TenantConfig {
  slug: string;
  displayName: string;
  webhookSecret: string;
  lineChannelToken: string;
  lineGroupIdBusinessAssist: string;
  allowedSheetPaths: string[]; // M2 起 NotifyService.handle 開頭驗；M1 只 build 不驗
}

// 已知 tenant slug → 顯示名（新客戶進來時在此加行）
const KNOWN_TENANT_DISPLAY_NAMES: Record<string, string> = {
  twh: "台灣福祉",
  xianyong: "鮮勇",
};

const MIN_SECRET_LENGTH = 16;

// 從 env 掃出 NOTIFY_WEBHOOK_SECRET_<SLUG> 對應的 slug 集合
// 例：NOTIFY_WEBHOOK_SECRET_XIANYONG → slug "xianyong"
function extractSuffixSlugs(env: Record<string, string | undefined>): string[] {
  const suffixes = new Set<string>();
  for (const key of Object.keys(env)) {
    const m = key.match(/^NOTIFY_WEBHOOK_SECRET_(.+)$/);
    if (m && m[1] && env[key] && env[key]!.trim() !== "") {
      suffixes.add(m[1].toLowerCase());
    }
  }
  return [...suffixes].sort();
}

function readTrimmed(env: Record<string, string | undefined>, key: string): string | undefined {
  const v = env[key];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function parseSheetPaths(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// 純函數：從 env 建 tenant 清單 + startup validation。
// 缺項 / 碰撞 / secret 太短 → 立即 throw；讓 Nest boot 直接 crash（fail-loud）。
export function buildTenantRegistry(
  env: Record<string, string | undefined>,
): TenantConfig[] {
  const tenants: TenantConfig[] = [];

  // Default tenant（台灣福祉）— 讀舊 env（無後綴）
  const defaultSecret = readTrimmed(env, "NOTIFY_WEBHOOK_SECRET");
  const defaultToken = readTrimmed(env, "LINE_CHANNEL_ACCESS_TOKEN");
  const defaultGroup = readTrimmed(env, "LINE_GROUP_ID_BUSINESS_ASSIST");
  const defaultSheets = parseSheetPaths(readTrimmed(env, "NOTIFY_TENANT_SHEETS_TWH"));

  if (defaultSecret) {
    if (defaultSecret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `NOTIFY_WEBHOOK_SECRET 長度 ${defaultSecret.length} < ${MIN_SECRET_LENGTH}，過短`,
      );
    }
    if (!defaultToken) throw new Error("default tenant 缺 LINE_CHANNEL_ACCESS_TOKEN");
    if (!defaultGroup) throw new Error("default tenant 缺 LINE_GROUP_ID_BUSINESS_ASSIST");
    tenants.push({
      slug: "twh",
      displayName: KNOWN_TENANT_DISPLAY_NAMES.twh,
      webhookSecret: defaultSecret,
      lineChannelToken: defaultToken,
      lineGroupIdBusinessAssist: defaultGroup,
      allowedSheetPaths: defaultSheets,
    });
  }

  // Suffix tenants — 掃 NOTIFY_WEBHOOK_SECRET_<SLUG>
  for (const slug of extractSuffixSlugs(env)) {
    if (tenants.some((t) => t.slug === slug)) {
      throw new Error(
        `tenant slug 碰撞：'${slug}'（default tenant 已用相同 slug）`,
      );
    }
    const upper = slug.toUpperCase();
    const secret = readTrimmed(env, `NOTIFY_WEBHOOK_SECRET_${upper}`);
    const token = readTrimmed(env, `LINE_CHANNEL_ACCESS_TOKEN_${upper}`) ?? defaultToken;
    // Group id 也支援 fallback default（測試階段共用同一業助群、audit 仍走 tenant_id 分流）
    const group = readTrimmed(env, `LINE_GROUP_ID_BUSINESS_ASSIST_${upper}`) ?? defaultGroup;
    const sheets = parseSheetPaths(readTrimmed(env, `NOTIFY_TENANT_SHEETS_${upper}`));

    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `tenant '${slug}' 的 NOTIFY_WEBHOOK_SECRET_${upper} 缺或過短（< ${MIN_SECRET_LENGTH}）`,
      );
    }
    if (!token) {
      throw new Error(
        `tenant '${slug}' 缺 LINE_CHANNEL_ACCESS_TOKEN_${upper}（且無 default fallback）`,
      );
    }
    if (!group) {
      throw new Error(
        `tenant '${slug}' 缺 LINE_GROUP_ID_BUSINESS_ASSIST_${upper}（且無 default fallback）`,
      );
    }
    tenants.push({
      slug,
      displayName: KNOWN_TENANT_DISPLAY_NAMES[slug] ?? slug,
      webhookSecret: secret,
      lineChannelToken: token,
      lineGroupIdBusinessAssist: group,
      allowedSheetPaths: sheets,
    });
  }

  // Cross-tenant secret 碰撞（避免 tenant A/B 撞同 secret）
  const seen = new Map<string, string>();
  for (const t of tenants) {
    const prev = seen.get(t.webhookSecret);
    if (prev) {
      throw new Error(`tenant '${prev}' 與 '${t.slug}' 的 webhookSecret 碰撞`);
    }
    seen.set(t.webhookSecret, t.slug);
  }

  if (tenants.length === 0) {
    throw new Error(
      "notify 模組無任何 tenant 配置：請至少設定 NOTIFY_WEBHOOK_SECRET + LINE_CHANNEL_ACCESS_TOKEN + LINE_GROUP_ID_BUSINESS_ASSIST",
    );
  }
  return tenants;
}

@Injectable()
export class TenantRegistry {
  private readonly logger = new Logger(TenantRegistry.name);
  private readonly tenants: TenantConfig[];

  // @Optional() 告訴 Nest DI 這個參數可以不 inject（Nest 塞 undefined）
  // 生產：Nest new 時無 param → 走 process.env
  // 測試：直接 `new TenantRegistry(customEnv)` 傳入 env 對象
  constructor(@Optional() env?: Record<string, string | undefined>) {
    this.tenants = buildTenantRegistry(env ?? process.env);
    this.logger.log(
      `notify tenants 註冊：${this.tenants.map((t) => `${t.slug}(${t.displayName})`).join(", ")}`,
    );
  }

  all(): TenantConfig[] {
    return this.tenants;
  }

  bySlug(slug: string): TenantConfig | undefined {
    return this.tenants.find((t) => t.slug === slug);
  }
}
