import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import UpdateBanner from "./UpdateBanner";
import { PermissionProvider } from "./permission/PermissionContext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UpdateBanner />
    <PermissionProvider>
      <App />
    </PermissionProvider>
  </React.StrictMode>,
);
