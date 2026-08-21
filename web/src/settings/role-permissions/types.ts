// 權限管理頁的統一角色視圖 · custom-roles v0.3 M6
//
// 內建角色（以 roleKey 識別、可分岔）與自建角色（以 roleId 識別、有資料範圍）
// 走的是兩支不同的 API，但畫面上是同一份清單、同一個編輯器。
// 這個型別是兩者的交集 —— 讓 RoleList 與權限編輯器不必知道自己在處理哪一種。
export interface ViewRole {
  /** 選取用的複合鍵：`b:<roleKey>` 或 `c:<roleId>` · 兩邊的 id 空間不同，不能混用 */
  sel: string;
  name: string;
  permissions: string[];
  memberCount: number;
  isCustom: boolean;
  /** 內建角色才有：已被本公司分岔調整過 */
  isCustomized: boolean;
  /** 內建角色的 API 鍵 */
  roleKey: string;
  /** 自建角色的 API 鍵 */
  roleId?: string;
  /** 清單第三行的說明 */
  sourceHint: string;
}
