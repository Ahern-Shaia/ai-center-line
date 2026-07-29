import { useEffect, useState } from "react";
import { fetchMediaBlobUrl, type TicketMedia } from "../api";

/**
 * 來源訊息裡的照片／影片縮圖。
 *
 * ⚠️ 為什麼不直接 `<img src>`：檔案要帶 JWT 才拿得到，而 `<img>` 送不出
 * Authorization header。走 blob 也順便讓 R2 的網址完全不進瀏覽器。
 */
function Thumb({ m, onOpen }: { m: TicketMedia; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    fetchMediaBlobUrl(m.mediaId)
      .then((u) => { if (revoked) { URL.revokeObjectURL(u); return; } objectUrl = u; setUrl(u); })
      .catch(() => setFailed(true));
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [m.mediaId]);

  if (failed) return <div className="tm-thumb tm-thumb-failed" title="沒有權限或檔案已刪除">無法顯示</div>;
  if (!url) return <div className="tm-thumb tm-thumb-loading" />;
  if (m.kind === "video") {
    return <video className="tm-thumb" src={url} controls preload="metadata" />;
  }
  return (
    <button className="tm-thumb-btn" onClick={() => onOpen(url)} title={`${m.at} ${m.sender}`}>
      <img className="tm-thumb" src={url} alt={`${m.sender} 於 ${m.at} 傳的照片`} loading="lazy" />
    </button>
  );
}

export default function MediaStrip({ media }: { media: TicketMedia[] }) {
  const [zoom, setZoom] = useState<string | null>(null);
  if (media.length === 0) return null;

  return (
    <>
      <div className="tc-sec">
        <span className="tc-sec-lbl">這幾則訊息裡的照片（{media.length} 張）</span>
        <div className="tm-strip">
          {media.map((m) => <Thumb key={m.mediaId} m={m} onOpen={setZoom} />)}
        </div>
      </div>
      {/* 點開看大圖 —— 縮圖看不清楚就等於沒給 */}
      {zoom && (
        <div className="tm-lightbox" onClick={() => setZoom(null)} role="presentation">
          <img src={zoom} alt="放大檢視" />
        </div>
      )}
    </>
  );
}
