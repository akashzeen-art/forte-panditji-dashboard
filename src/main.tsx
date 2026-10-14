import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initFirebaseAnalytics } from "./lib/firebase";
import "./index.css";

// Suppress Firebase Installations 400 noise — caused by the domain not being
// added to Firebase Console → Authentication → Settings → Authorised domains.
// Fix: add panditji.myastrosutra.online there. Until then, silence the error.
const _origError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? "");
  if (
    msg.includes("installations/request-failed") ||
    msg.includes("firebaseinstallations") ||
    msg.includes("INVALID_ARGUMENT")
  ) return;
  _origError(...args);
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void initFirebaseAnalytics();
