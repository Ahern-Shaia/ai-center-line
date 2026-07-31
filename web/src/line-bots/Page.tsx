import { useCallback, useEffect, useState } from "react";
import {
  listLineBots,
  getLineBot,
  getLineRefs,
  disableLineBot,
  getSession,
  ApiError,
  type LineBotDto,
  type LineGroupRow,
  type LineRefsDto,
  enableLineBot,
  lineBotDeleteImpact,
  deleteLineBotPermanently,
  type LineBotDeleteImpact,
} from "../api";
import ConfirmDialog from "../shared/ConfirmDialog";
import { useToast } from "../Toast";
import { BotList, BotDetailEmpty } from "./List";
import { BotDetail } from "./Detail";
import { NewBotDrawer, EditBotDrawer, DisableConfirmModal } from "./Drawers";

type DrawerState = null | { kind: "new" } | { kind: "edit"; botId: string };

// LINE 機器人管理主頁 · Master-Detail Split
// 子組件見 LineBotList / LineBotDetail / LineBotDrawers · 拆自單檔 > 500 行時期的巨怪
export default function LineBots() {
  const session = getSession();
  const canManage = session?.role === "aiproot_admin";
  const canView = session?.role === "aiproot_admin" || session?.role === "consultant";
  const toast = useToast();

  const [bots, setBots] = useState<LineBotDto[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [botDetail, setBotDetail] = useState<{ bot: LineBotDto; groups: LineGroupRow[] } | null>(null);
  const [refs, setRefs] = useState<LineRefsDto>({ tenants: [], departments: [] });
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [confirmDisable, setConfirmDisable] = useState<string | null>(null);
  // 永久刪除是 CASCADE —— 群組/訊息/成員/員工綁定會一起消失，所以要先算清楚給人看
  const [purge, setPurge] = useState<{ botId: string; impact: LineBotDeleteImpact } | null>(null);
  const [purging, setPurging] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!canView) return;                    // 早退防禦 · 避免無權限使用者連續打 API
    setLoading(true);
    try {
      const [botsRes, refsRes] = await Promise.all([listLineBots(), getLineRefs()]);
      setBots(botsRes.bots);
      setRefs(refsRes);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [toast, canView]);

  useEffect(() => { refresh(); }, [refresh]);

  // 無權限使用者直接顯示空狀態 · 不打任何 API
  if (!canView) {
    return (
      <div className="pane lbot-pane">
        <div className="lbot-hdr"><h1>LINE 機器人管理</h1></div>
        <div className="lbot-list-empty" style={{ marginTop: 40 }}>
          <div>此頁僅限 aiproot 平台方管理</div>
          <div className="lbot-list-empty-hint">如需協助 · 請聯繫 aiproot 支援</div>
        </div>
      </div>
    );
  }

  // 從 URL hash 讀選中 · 支援 deep link (#/line-bots/<botId>)
  useEffect(() => {
    const readHash = () => {
      const m = /^#\/line-bots\/([0-9a-f-]+)$/.exec(window.location.hash);
      if (m) setSelectedBotId(m[1]);
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  // 選中變更 · 拉 detail + 更新 URL hash + 拉該 tenant 的 departments 給下拉用
  useEffect(() => {
    if (!selectedBotId) {
      setBotDetail(null);
      setRefs((r) => ({ ...r, departments: [] }));
      if (window.location.hash.startsWith("#/line-bots/")) {
        window.location.hash = "#/line-bots";
      }
      return;
    }
    getLineBot(selectedBotId)
      .then(async (res) => {
        setBotDetail(res);
        // 重拉 refs · 依 bot 的 tenantId scope departments
        try {
          const scopedRefs = await getLineRefs(res.bot.tenantId ?? undefined);
          setRefs(scopedRefs);
        } catch { /* 忽略 · UI 保留舊 refs */ }
      })
      .catch((err) => {
        setSelectedBotId(null);
        toast.show(err instanceof ApiError ? err.message : "找不到機器人", "danger");
      });
    window.location.hash = `#/line-bots/${selectedBotId}`;
  }, [selectedBotId, toast]);

  const reloadDetail = useCallback(async () => {
    if (!selectedBotId) return;
    try {
      const res = await getLineBot(selectedBotId);
      setBotDetail(res);
      const botsRes = await listLineBots();
      setBots(botsRes.bots);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "刷新失敗", "danger");
    }
  }, [selectedBotId, toast]);

  return (
    <div className="pane lbot-pane">
      <div className="lbot-hdr">
        <h1>LINE 機器人管理</h1>
        {canManage && (
          <button className="btn btn-primary" onClick={() => setDrawer({ kind: "new" })}>
            + 新增機器人
          </button>
        )}
      </div>

      <div className="lbot-split">
        <BotList
          bots={bots}
          selectedId={selectedBotId}
          onSelect={setSelectedBotId}
          loading={loading}
          canManage={canManage}
        />
        {selectedBotId && botDetail ? (
          <BotDetail
            detail={botDetail}
            refs={refs}
            canManage={canManage}
            onEdit={() => setDrawer({ kind: "edit", botId: selectedBotId })}
            onDisable={() => setConfirmDisable(selectedBotId)}
            onEnable={async () => {
              try {
                await enableLineBot(selectedBotId);
                toast.show("已重新啟用", "ok");
                reloadDetail();
              } catch (err) {
                toast.show(err instanceof ApiError ? err.message : "啟用失敗", "danger");
              }
            }}
            onDeletePermanently={async () => {
              try {
                setPurge({ botId: selectedBotId, impact: await lineBotDeleteImpact(selectedBotId) });
              } catch (err) {
                toast.show(err instanceof ApiError ? err.message : "無法讀取刪除影響", "danger");
              }
            }}
            onReload={reloadDetail}
          />
        ) : (
          <BotDetailEmpty canManage={canManage} onNew={() => setDrawer({ kind: "new" })} />
        )}
      </div>

      {drawer?.kind === "new" && (
        <NewBotDrawer
          refs={refs}
          onClose={() => setDrawer(null)}
          onCreated={(newBot) => {
            setDrawer(null);
            setBots((prev) => [newBot, ...prev]);
            setSelectedBotId(newBot.botId);
          }}
        />
      )}
      {drawer?.kind === "edit" && botDetail && (
        <EditBotDrawer
          bot={botDetail.bot}
          tenants={refs.tenants}
          onClose={() => setDrawer(null)}
          onSaved={() => {
            setDrawer(null);
            reloadDetail();
          }}
        />
      )}

      <ConfirmDialog
        open={!!purge}
        onClose={() => !purging && setPurge(null)}
        onConfirm={async () => {
          if (!purge) return;
          setPurging(true);
          try {
            await deleteLineBotPermanently(purge.botId);
            toast.show("已永久刪除", "ok");
            setPurge(null);
            window.location.reload();
          } catch (err) {
            toast.show(err instanceof ApiError ? err.message : "刪除失敗", "danger");
          } finally { setPurging(false); }
        }}
        busy={purging}
        tone="danger"
        title="永久刪除這個機器人？"
        confirmLabel="永久刪除"
        body={purge && (
          <>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{purge.impact.botName}</div>
            <p style={{ margin: "0 0 8px" }}>以下資料會<b>一併永久刪除，無法復原</b>：</p>
            <ul style={{ margin: "0 0 8px", paddingLeft: 20 }}>
              <li>群組 <b>{purge.impact.groups}</b> 個</li>
              <li>歷史訊息 <b>{purge.impact.messages}</b> 則</li>
              <li>群成員紀錄 <b>{purge.impact.members}</b> 筆</li>
              <li>員工 LINE 綁定 <b>{purge.impact.bindings}</b> 筆</li>
            </ul>
            {purge.impact.bindings > 0 && (
              <p style={{ color: "var(--danger)", fontSize: 13 }}>
                ⚠️ 有 {purge.impact.bindings} 位同仁的 LINE 綁定會被解除，
                他們的打卡與日報將對不到人，需要重新綁定。
              </p>
            )}
          </>
        )}
      />

      {confirmDisable && (
        <DisableConfirmModal
          botName={botDetail?.bot.name ?? ""}
          onCancel={() => setConfirmDisable(null)}
          onConfirm={async () => {
            try {
              await disableLineBot(confirmDisable);
              toast.show("機器人已停用", "ok");
              setConfirmDisable(null);
              reloadDetail();
            } catch (err) {
              toast.show(err instanceof ApiError ? err.message : "停用失敗", "danger");
            }
          }}
        />
      )}
    </div>
  );
}
