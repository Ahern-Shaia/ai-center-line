import { useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CUSTOMERS, type Customer } from "../mockdata/customers";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

// 分區色（對應 observability-light 語意色 + 紫）
const CITY_REGION: Record<string, "north" | "central" | "south" | "east"> = {
  "台北市": "north", "新北市": "north", "桃園市": "north",
  "台中市": "central", "彰化縣": "central", "雲林縣": "central", "嘉義市": "central",
  "台南市": "south", "高雄市": "south", "屏東縣": "south",
  "宜蘭縣": "east", "花蓮縣": "east",
};
const REGION_COLOR: Record<string, string> = {
  north: "#4F46E5", central: "#059669", south: "#D97706", east: "#7C3AED",
};
const REGION_LABEL: Record<string, string> = {
  north: "北部", central: "中部", south: "南部", east: "東部",
};

function makeMarkerIcon(color: string, active: boolean, vehicles: number): L.DivIcon {
  const size = active ? 30 : 24;
  return L.divIcon({
    className: "cm-marker-wrap",
    html: `<div class="cm-marker${active ? " active" : ""}" style="background:${color};width:${size}px;height:${size}px;">${vehicles}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// 地圖跟隨選中案場自動 flyTo
function FlyToSelected({ customer }: { customer: Customer | null }) {
  const map = useMap();
  if (customer) {
    map.flyTo([customer.lat, customer.lng], 11, { duration: 0.8 });
  }
  return null;
}

export default function CustomerMap() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => CUSTOMERS.find((c) => c.id === selectedId) ?? null, [selectedId]);

  const totalVehicles = CUSTOMERS.reduce((n, c) => n + c.vehicleCount, 0);
  const cityCount = new Set(CUSTOMERS.map((c) => c.city)).size;

  const sortedByDate = useMemo(
    () => CUSTOMERS.slice().sort((a, b) => b.latestServiceAt.localeCompare(a.latestServiceAt)),
    [],
  );

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>客戶地圖</h1>
          <div className="sub">終端案場（車主 / 照護單位）地理分佈 · 共 {CUSTOMERS.length} 個案場 · 覆蓋 {cityCount} 縣市 · 服務中車輛 {totalVehicles} 台</div>
        </div>
      </div>

      <div className="cm-map-layout">
        <div className="cm-map-card">
          <div className="cm-map-legend">
            {(["north","central","south","east"] as const).map((r) => (
              <span key={r} className="cm-legend">
                <span className="cm-legend-dot" style={{ background: REGION_COLOR[r] }} />
                {REGION_LABEL[r]}
              </span>
            ))}
            <span className="cm-legend-hint">數字＝該案場服務中車輛數</span>
          </div>
          <div className="cm-map-container">
            <MapContainer
              center={[23.7, 120.9]}
              zoom={7}
              scrollWheelZoom
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · &copy; <a href="https://carto.com/attributions">CARTO</a>'
                subdomains={["a", "b", "c", "d"]}
              />
              <FlyToSelected customer={selected} />
              {CUSTOMERS.map((c) => {
                const region = CITY_REGION[c.city] ?? "central";
                const color = REGION_COLOR[region];
                const active = selectedId === c.id;
                return (
                  <Marker
                    key={c.id}
                    position={[c.lat, c.lng]}
                    icon={makeMarkerIcon(color, active, c.vehicleCount)}
                    eventHandlers={{ click: () => setSelectedId(c.id) }}
                  >
                    <Popup>
                      <div className="cm-popup">
                        <div className="cm-popup-title">{c.name}</div>
                        <div className="cm-popup-meta">
                          <span>{c.vehicleCount} 台服務中</span>
                          <span className="cm-list-dot">·</span>
                          <span className="mono">{fmtDate(c.latestServiceAt)}</span>
                        </div>
                        <div className="cm-popup-vehicles">{c.vehicles.join(" · ")}</div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>
        </div>

        <div className="cm-list-card">
          <div className="cm-list-hdr">
            <span>案場清單</span>
            <span className="cm-list-sub">依最近服務排序</span>
          </div>
          <div className="cm-list">
            {sortedByDate.map((c) => {
              const region = CITY_REGION[c.city] ?? "central";
              const active = selectedId === c.id;
              return (
                <button
                  key={c.id}
                  className={`cm-list-item${active ? " active" : ""}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <span className="cm-list-marker" style={{ background: REGION_COLOR[region] }}>{c.vehicleCount}</span>
                  <span className="cm-list-content">
                    <span className="cm-list-name">{c.name}</span>
                    <span className="cm-list-meta">
                      <span>{c.city} {c.district}</span>
                      <span className="cm-list-dot">·</span>
                      <span className="mono">最近 {fmtDate(c.latestServiceAt)}</span>
                    </span>
                    <span className="cm-list-vehicles">{c.vehicles.slice(0, 3).join(" · ")}{c.vehicles.length > 3 ? ` 等` : ""}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
