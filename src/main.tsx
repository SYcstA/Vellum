import React from "react";
import ReactDOM from "react-dom/client";

// The quick-capture window loads this same bundle at `#capture`. Import only
// what each window needs so the capture window stays light and never boots
// the dashboard.
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const entry = window.location.hash === "#capture"
  ? import("./components/QuickCapture")
  : import("./App");

entry.then(({ default: Root }) => {
  root.render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
});
