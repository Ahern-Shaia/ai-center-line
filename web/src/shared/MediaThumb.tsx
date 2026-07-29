import { useEffect, useState } from "react";
import { fetchMediaBlobUrl } from "../api";

/**
 * 訊息裡的照片／影片縮圖。
 *
 * ⚠️ 為什麼不直接 `<img src>`：檔案要帶 JWT 才拿得到，而 `<img>` 送不出
 * Authorization header。走 blob 也順便讓 R2 的網址完全不進瀏覽器。
 *
 * ⚠️ 為什麼內嵌在訊息裡而不是另外列一排：原文只寫「[照片]」，
 * 另外列的話「這個可以嗎」指的是哪一張就看不出來 —— 而那正是主管要判斷的東西。
 */
export default function MessageMedia({ mediaId, kind }: { mediaId: string; kind: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchMediaBlobUrl(mediaId)
      .then((u) => { if (cancelled) { URL.revokeObjectURL(u); return; } objectUrl = u; setUrl(u); })
      .catch(() => setFailed(true));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [mediaId]);

  if (failed) return <div className="tm-thumb tm-thumb-failed" title="沒有權限或檔案已刪除">無法顯示</div>;
  if (!url) return <div className="tm-thumb tm-thumb-loading" />;
  if (kind === "video") return <video className="tm-thumb" src={url} controls preload="metadata" />;

  return (
    <>
      <button className="tm-thumb-btn" onClick={() => setZoom(true)} title="點開看大圖">
        <img className="tm-thumb" src={url} alt="來源訊息的照片" loading="lazy" />
      </button>
      {/* 縮圖看不清楚就等於沒給 */}
      {zoom && (
        <div className="tm-lightbox" onClick={() => setZoom(false)} role="presentation">
          <img src={url} alt="放大檢視" />
        </div>
      )}
    </>
  );
}
