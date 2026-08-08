import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LaunchdStudioApp } from "@launchd-studio/web-ui";
import "@launchd-studio/web-ui/styles.css";
import { BrowserStudioTransport } from "./browser-transport";
import {
  clearTokenFragment,
  HttpStudioTransport,
  loadStoredToken,
  storeToken,
  tokenFromLocation,
} from "./http-transport";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("The root element is missing.");
}

const fragmentToken = tokenFromLocation(window.location);
if (fragmentToken !== null) {
  storeToken(window.sessionStorage, fragmentToken);
  clearTokenFragment();
}
const token = fragmentToken ?? loadStoredToken(window.sessionStorage);
const transport = token === null
  ? new BrowserStudioTransport()
  : new HttpStudioTransport(token);

createRoot(root).render(
  <StrictMode>
    <LaunchdStudioApp transport={transport} />
  </StrictMode>,
);
