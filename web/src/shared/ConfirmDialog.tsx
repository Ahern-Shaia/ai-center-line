import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useT } from "../i18n/useT";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body?: ReactNode;                   // 主訊息 (可為 ReactNode · 允簡述 + 細節區隔)
  confirmLabel?: string;               // default "確定"
  cancelLabel?: string;                // default "取消"
  tone?: "primary" | "danger";        // 主按鈕語意 · danger 用於破壞性操作
  busy?: boolean;                      // 執行中禁 double-click
}

/**
 * 中央置中確認對話框 · 取代 window.confirm()
 * React Aria Modal 附送 focus trap / Esc 關 / scrim click 關 / aria-labelledby
 */
export default function ConfirmDialog({
  open, onClose, onConfirm, title, body,
  confirmLabel, cancelLabel,
  tone = "primary", busy = false,
}: Props) {
  const tr = useT();
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(v) => { if (!v && !busy) onClose(); }}
      isDismissable={!busy}
      className="cd-scrim"
    >
      <Modal className="cd-modal">
        <Dialog className="cd-dialog">
          <Heading slot="title" className="cd-title">{title}</Heading>
          {body && <div className="cd-body">{body}</div>}
          <div className="cd-actions">
            <button className="btn" onClick={onClose} disabled={busy}>{cancelLabel}</button>
            <button
              className={`btn ${tone === "danger" ? "danger" : "primary"}`}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? tr("common.working") : (confirmLabel ?? tr("common.ok"))}
            </button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
