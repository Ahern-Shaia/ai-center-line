import type { ReactNode } from "react";
import { usePermissions } from "./PermissionContext";

// 用法：
// <PermGate perm="line-bots:create"><Button /></PermGate>
// <PermGate any={["a:x", "b:y"]}>...</PermGate>
// <PermGate perm="X" fallback={<span>沒權限</span>}>...</PermGate>
export function PermGate({ perm, any, fallback = null, children }: {
  perm?: string;
  any?: string[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { has, hasAny } = usePermissions();
  const allowed = perm ? has(perm) : any ? hasAny(...any) : false;
  return <>{allowed ? children : fallback}</>;
}
