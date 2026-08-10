import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LaunchdStudioApp } from "@launchd-studio/web-ui";
import "@launchd-studio/web-ui/styles.css";
import { HttpStudioTransport } from "./http-transport";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("The root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <LaunchdStudioApp transport={new HttpStudioTransport()} />
  </StrictMode>,
);
