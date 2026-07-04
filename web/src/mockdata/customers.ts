// 客戶地圖 mock — 台灣福祉的終端客戶（車主/案場）分佈。demo 錄影用。
// 注意：spec §1-B B4-2 「客戶」指台灣福祉的終端案場，**不是** aiproot 的租戶。
export interface Customer {
  id: string;
  name: string;
  city: string;      // 縣市
  district: string;  // 鄉鎮
  lat: number;       // 緯度
  lng: number;       // 經度
  vehicleCount: number;
  latestServiceAt: string;
  vehicles: string[];  // 車型
}

// 座標為各縣市中心附近點；demo 用假資料，不代表真實案場位置
export const CUSTOMERS: Customer[] = [
  { id: "C-001", name: "某長照機構（台北市大安區）", city: "台北市", district: "大安區", lat: 25.0263, lng: 121.5436, vehicleCount: 4, latestServiceAt: "2026-07-02T14:30:00", vehicles: ["復康巴士 STARIA", "沐浴車", "福祉車 CADDY MAXI"] },
  { id: "C-002", name: "某社福基金會（新北市板橋區）", city: "新北市", district: "板橋區", lat: 25.0126, lng: 121.4675, vehicleCount: 6, latestServiceAt: "2026-07-01T10:12:00", vehicles: ["復康巴士 STARIA", "復康巴士 HIACE", "沐浴車"] },
  { id: "C-003", name: "某長照 A 級單位（桃園市中壢區）", city: "桃園市", district: "中壢區", lat: 24.9530, lng: 121.2251, vehicleCount: 3, latestServiceAt: "2026-06-28T09:45:00", vehicles: ["復康巴士 STARIA", "福祉車 CADDY MAXI"] },
  { id: "C-004", name: "某醫院附設日照(台中市北區)", city: "台中市", district: "北區", lat: 24.1621, lng: 120.6849, vehicleCount: 5, latestServiceAt: "2026-06-30T15:20:00", vehicles: ["復康巴士 STARIA×2", "沐浴車", "福祉車"] },
  { id: "C-005", name: "某榮民之家（台中市大里區）", city: "台中市", district: "大里區", lat: 24.1054, lng: 120.6835, vehicleCount: 2, latestServiceAt: "2026-06-25T11:08:00", vehicles: ["復康巴士 HIACE", "沐浴車"] },
  { id: "C-006", name: "某教會照護機構（彰化縣鹿港鎮）", city: "彰化縣", district: "鹿港鎮", lat: 24.0568, lng: 120.4344, vehicleCount: 3, latestServiceAt: "2026-06-18T14:00:00", vehicles: ["復康巴士 ABC-1234", "沐浴車", "福祉車"] },
  { id: "C-007", name: "某長照社區（雲林縣斗六市）", city: "雲林縣", district: "斗六市", lat: 23.7075, lng: 120.5470, vehicleCount: 2, latestServiceAt: "2026-06-22T09:30:00", vehicles: ["復康巴士 STARIA", "沐浴車"] },
  { id: "C-008", name: "某醫院照護中心（嘉義市西區）", city: "嘉義市", district: "西區", lat: 23.4801, lng: 120.4491, vehicleCount: 4, latestServiceAt: "2026-06-15T13:45:00", vehicles: ["復康巴士 STARIA×2", "沐浴車", "福祉車"] },
  { id: "C-009", name: "某社福基金會（台南市東區）", city: "台南市", district: "東區", lat: 22.9873, lng: 120.2274, vehicleCount: 5, latestServiceAt: "2026-06-20T10:20:00", vehicles: ["復康巴士 STARIA", "復康巴士 HIACE", "沐浴車×2", "福祉車"] },
  { id: "C-010", name: "某長照 B 級單位（高雄市三民區）", city: "高雄市", district: "三民區", lat: 22.6470, lng: 120.3117, vehicleCount: 7, latestServiceAt: "2026-07-03T16:05:00", vehicles: ["復康巴士 STARIA×3", "沐浴車×2", "福祉車×2"] },
  { id: "C-011", name: "某老人福利協會（高雄市鳳山區）", city: "高雄市", district: "鳳山區", lat: 22.6272, lng: 120.3626, vehicleCount: 3, latestServiceAt: "2026-06-27T14:30:00", vehicles: ["復康巴士 STARIA", "沐浴車", "福祉車"] },
  { id: "C-012", name: "某照護機構（屏東縣屏東市）", city: "屏東縣", district: "屏東市", lat: 22.6720, lng: 120.4886, vehicleCount: 2, latestServiceAt: "2026-06-14T09:00:00", vehicles: ["復康巴士 HIACE", "沐浴車"] },
  { id: "C-013", name: "某教會日照中心（宜蘭縣宜蘭市）", city: "宜蘭縣", district: "宜蘭市", lat: 24.7570, lng: 121.7539, vehicleCount: 2, latestServiceAt: "2026-06-19T11:15:00", vehicles: ["復康巴士 STARIA", "沐浴車"] },
  { id: "C-014", name: "某醫院附設安養（花蓮縣花蓮市）", city: "花蓮縣", district: "花蓮市", lat: 23.9871, lng: 121.6015, vehicleCount: 3, latestServiceAt: "2026-06-08T15:30:00", vehicles: ["復康巴士 STARIA×2", "福祉車"] },
];
