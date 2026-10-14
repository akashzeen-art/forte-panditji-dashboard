import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import { normalizeApiStatus, normalizeMobile, type PanditApiStatus } from "./api";
import { isSameOriginUrl, resolveSockJsUrl } from "../lib/upstream";

const WS_EVENT = "pandit-dashboard-ws-status";
const CUSTOMER_EVENT = "pandit-dashboard-ws-customer";
const SOCKJS_PATH = import.meta.env.VITE_PANDIT_WS_URL || "/api/ws";
const STATUS_TOPIC = "/topic/pandit/status";
/** Backend: { customer, status: "oncall" | "show-qr" } */
const SHOW_QR_TOPIC = "/topic/show-qr";
/** Backend: { mobile, agent, status: "CALLING" | "CALL ENDED" } */
const CALL_STATUS_TOPIC = "/topic/call/status";
const RECONNECT_MS = 8_000;

const L = (msg: string, ...a: unknown[]) =>
  console.log(`%c[pandit-socket] ${msg}`, "color:#34d399;font-weight:bold", ...a);
const LE = (msg: string, ...a: unknown[]) =>
  console.error(`%c[pandit-socket] ${msg}`, "color:#f87171;font-weight:bold", ...a);

export type WsStatusPayload = {
  mobile: string;
  status: PanditApiStatus;
};

export type CustomerCallEvent = {
  customer: string;
  /** Pandit mobile when the backend includes it — used to ignore other Pandit Ji's calls. */
  pandit: string;
  phase: "oncall" | "ended";
};

let client: Client | null = null;
let started = false;
let connected = false;

export function isSocketConnected(): boolean {
  return connected;
}

function createSockJsSocket(url: string): WebSocket {
  const sameOrigin = isSameOriginUrl(url);
  const transports = sameOrigin
    ? (["websocket", "xhr-streaming", "xhr-polling"] as const)
    : (["xhr-streaming", "xhr-polling"] as const);

  const sock = new SockJS(url, null, {
    transports: [...transports],
    timeout: 12_000,
  });
  return sock as unknown as WebSocket;
}

function emitStatus(mobile: string, statusRaw: string) {
  const digits = normalizeMobile(mobile);
  if (digits.length < 10) return null;

  const status = normalizeApiStatus(statusRaw);
  const detail: WsStatusPayload = { mobile: digits, status };
  window.dispatchEvent(new CustomEvent(WS_EVENT, { detail }));
  return detail;
}

export function onWsStatus(callback: (payload: WsStatusPayload) => void): () => void {
  const handler = (e: Event) => {
    callback((e as CustomEvent<WsStatusPayload>).detail);
  };
  window.addEventListener(WS_EVENT, handler);
  return () => window.removeEventListener(WS_EVENT, handler);
}

export function onCustomerCall(callback: (payload: CustomerCallEvent) => void): () => void {
  const handler = (e: Event) => {
    callback((e as CustomEvent<CustomerCallEvent>).detail);
  };
  window.addEventListener(CUSTOMER_EVENT, handler);
  return () => window.removeEventListener(CUSTOMER_EVENT, handler);
}

function emitCustomerCall(body: string, allowMobileKey: boolean) {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    LE("bad JSON", body);
    return;
  }

  L("raw payload", { ...data, _allowMobileKey: allowMobileKey });

  const customer = normalizeMobile(
    String(data.customer ?? (allowMobileKey ? (data.mobile ?? "") : "")),
  );
  if (customer.length !== 10) {
    L("skipped — no valid customer number", { customer: data.customer, mobile: data.mobile });
    return;
  }

  const statusRaw = String(data.status || "").trim();
  const statusNorm = statusRaw.toLowerCase().replace(/[\s_-]+/g, "");

  // oncall / CALLING / CONNECTED / CALL STARTED → "oncall"
  const isOnCall =
    statusNorm === "oncall" ||
    statusNorm === "calling" ||
    statusNorm === "connected" ||
    statusNorm === "callstarted" ||
    statusNorm === "callconnected" ||
    statusNorm === "answered" ||
    statusNorm === "inprogress" ||
    statusNorm === "ongoing";

  const isEnded =
    statusNorm === "callended" ||
    statusNorm === "ended" ||
    statusNorm === "disconnected" ||
    statusNorm === "hangup" ||
    statusNorm === "callend";

  const phase = isOnCall ? "oncall" : isEnded ? "ended" : null;

  L("status check", { statusRaw, statusNorm, isOnCall, isEnded, phase });

  if (!phase) {
    L("skipped — unrecognised status", statusRaw);
    return;
  }

  const pandit = normalizeMobile(
    String(data.pandit ?? data.panditMobile ?? data.agent ?? data.agentNumber ?? ""),
  );

  const detail: CustomerCallEvent = { customer, pandit, phase };
  L("emitting CustomerCallEvent ✓", detail);
  window.dispatchEvent(new CustomEvent(CUSTOMER_EVENT, { detail }));
}

export function startPanditSocket(): void {
  if (started) {
    L("already started (connected=", connected, ")");
    return;
  }
  started = true;

  const sockJsUrl = resolveSockJsUrl(SOCKJS_PATH);
  L("starting STOMP client →", sockJsUrl);

  client = new Client({
    webSocketFactory: () => createSockJsSocket(sockJsUrl),
    reconnectDelay: RECONNECT_MS,
    heartbeatIncoming: 20_000,
    heartbeatOutgoing: 20_000,
    onConnect: () => {
      connected = true;
      L("CONNECTED ✓", { url: sockJsUrl });

      client?.subscribe(STATUS_TOPIC, (message) => {
        L("← " + STATUS_TOPIC, message.body);
        try {
          const data = JSON.parse(message.body) as { mobile?: string; status?: string };
          if (data?.mobile && data?.status) emitStatus(data.mobile, data.status);
          else LE("missing mobile/status", data);
        } catch (err) {
          LE("bad JSON on " + STATUS_TOPIC, err);
        }
      });
      L("subscribed →", STATUS_TOPIC);

      client?.subscribe(SHOW_QR_TOPIC, (message) => {
        L("← " + SHOW_QR_TOPIC, message.body);
        emitCustomerCall(message.body, false);
      });
      L("subscribed →", SHOW_QR_TOPIC);

      client?.subscribe(CALL_STATUS_TOPIC, (message) => {
        L("← " + CALL_STATUS_TOPIC, message.body);
        emitCustomerCall(message.body, true);
      });
      L("subscribed →", CALL_STATUS_TOPIC);
    },
    onDisconnect: () => {
      connected = false;
      L("DISCONNECTED");
    },
    onStompError: (frame) => {
      connected = false;
      LE("STOMP error", frame.headers["message"], frame.body);
    },
    onWebSocketClose: (evt) => {
      connected = false;
      L("socket closed", { code: (evt as CloseEvent)?.code, reason: (evt as CloseEvent)?.reason });
    },
    onWebSocketError: (err) => {
      connected = false;
      LE("socket error", err);
    },
  });

  client.activate();
}

export function stopPanditSocket(): void {
  started = false;
  connected = false;
  if (client) {
    void client.deactivate();
    client = null;
  }
}
