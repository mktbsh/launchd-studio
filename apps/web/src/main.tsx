import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LaunchdStudioApp } from "@launchd-studio/web-ui";
import "@launchd-studio/web-ui/styles.css";
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

function mountStudio() {
  const fragmentToken = tokenFromLocation(window.location);
  if (fragmentToken !== null) {
    storeToken(window.sessionStorage, fragmentToken);
    clearTokenFragment();
  }
  const token = fragmentToken ?? loadStoredToken(window.sessionStorage);
  if (token === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center text-[13px] text-[var(--text-3)]">
        Open this application through <code className="mx-1 font-mono">launchd-studio web-ui</code>,
        which supplies the local API token.
      </div>
    );
  }
  return <LaunchdStudioApp transport={new HttpStudioTransport(token)} />;
}

createRoot(root).render(
  <StrictMode>{mountStudio()}</StrictMode>,
);
