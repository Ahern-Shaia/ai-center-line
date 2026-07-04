import type { ReactNode } from "react";
import { Tooltip, TooltipTrigger, Focusable, OverlayArrow } from "react-aria-components";

// 通用資訊提示：對任何 focusable 子元素加 hover / focus tooltip。
// 用法：<InfoTip content="說明文字"><span className="pill ok">高信心</span></InfoTip>
export function InfoTip({ content, children, placement = "top" }: {
  content: ReactNode;
  children: ReactNode;
  placement?: "top" | "bottom" | "start" | "end";
}) {
  return (
    <TooltipTrigger delay={200} closeDelay={100}>
      <Focusable>
        <span tabIndex={0} className="infotip-target">{children}</span>
      </Focusable>
      <Tooltip className="tip" placement={placement} offset={6}>
        <OverlayArrow className="tip-arrow"><svg width="10" height="6" viewBox="0 0 10 6"><path d="M0 0 L5 6 L10 0" fill="var(--ink)" /></svg></OverlayArrow>
        {content}
      </Tooltip>
    </TooltipTrigger>
  );
}
