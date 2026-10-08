import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* 根级兜底边界：连接屏/顶层布局崩溃时给出可恢复界面而不是白屏 */}
    <ErrorBoundary label="应用">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
