import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Elemento #root não encontrado.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
