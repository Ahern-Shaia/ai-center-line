import { useEffect, useState } from "react";
import { getToken, setToken, login } from "./api";
import Login from "./Login";
import WarRoom from "./WarRoom";

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());

  // dev/demo 便利：網址帶 #demo 自動以 demo 帳號登入
  useEffect(() => {
    if (!authed && window.location.hash === "#demo") {
      login("gm@taiwanhomecare.demo", "demo123")
        .then(() => setAuthed(true))
        .catch(() => undefined);
    }
  }, [authed]);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  return (
    <WarRoom
      onLogout={() => {
        setToken(null);
        setAuthed(false);
      }}
    />
  );
}
