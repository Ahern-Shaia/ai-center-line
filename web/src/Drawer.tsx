import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}

// React Aria Modal + Dialog：拿到 focus trap、focus restore、Esc 關、scrim 點外關、
// aria-labelledby、body scroll lock — 全由 primitive 處理。
// 我們只保留視覺 CSS（.drawer-scrim / .drawer / .drawer-hdr / .drawer-body / .drawer-foot）。
export default function Drawer({ open, onClose, title, subtitle, width = 560, children, footer }: Props) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      isDismissable
      className="drawer-scrim"
    >
      <Modal className="drawer" style={{ width }}>
        <Dialog className="drawer-dialog">
          <header className="drawer-hdr">
            <div>
              <Heading slot="title" className="drawer-title">{title}</Heading>
              {subtitle && <div className="drawer-sub">{subtitle}</div>}
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="關閉">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>
          <div className="drawer-body">{children}</div>
          {footer && <footer className="drawer-foot">{footer}</footer>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
