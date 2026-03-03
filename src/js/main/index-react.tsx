import React from "react";
import ReactDOM from "react-dom/client";
import { initBolt } from "../lib/utils/bolt";
import "../index.css";
import { Toaster } from "../components/ui/sonner";
import { App } from "./main";
import { isBetaLocked } from "./lib/betaGate";
import { BetaLockedScreen } from "./components/BetaLockedScreen";

const locked = isBetaLocked();

if (!locked) {
  initBolt();
}

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <React.StrictMode>
    {locked ? <BetaLockedScreen /> : <App />}
    <Toaster />
  </React.StrictMode>
);
