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
/** Backend: { customer, status: "oncall" } or { mobile: customer, status: "CALL ENDED" } */
const CALL_STATUS_TOPIC = "/topic/call/status";
const RECONNECT_MS = 8_000;

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
    return;
  }
  const customer = normalizeMobile(String(data.customer ?? (allowMobileKey ? data.mobile : "") ?? ""));
  if (customer.length !== 10) return;

  const status = String(data.status || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const phase =
    status === "oncall"
      ? "oncall"
      : status === "callended" || status === "ended" || status === "disconnected"
        ? "ended"
        : null;
  if (!phase) return;

  const pandit = normalizeMobile(
    String(data.pandit ?? data.panditMobile ?? data.agent ?? data.agentNumber ?? ""),
  );
  const detail: CustomerCallEvent = { customer, pandit, phase };
  window.dispatchEvent(new CustomEvent(CUSTOMER_EVENT, { detail }));
}

export function startPanditSocket(): void {
  if (started) return;
  started = true;

  const sockJsUrl = resolveSockJsUrl(SOCKJS_PATH);

  client = new Client({
    webSocketFactory: () => createSockJsSocket(sockJsUrl),
    reconnectDelay: RECONNECT_MS,
    heartbeatIncoming: 20_000,
    heartbeatOutgoing: 20_000,
    onConnect: () => {
      connected = true;
      client?.subscribe(STATUS_TOPIC, (message) => {
        try {
          const data = JSON.parse(message.body) as {
            mobile?: string;
            status?: string;
          };
          if (data?.mobile && data?.status) {
            emitStatus(data.mobile, data.status);
          }
        } catch {
          /* ignore bad payload */
        }
      });
      client?.subscribe(SHOW_QR_TOPIC, (message) => emitCustomerCall(message.body, false));
      client?.subscribe(CALL_STATUS_TOPIC, (message) => emitCustomerCall(message.body, true));
    },
    onDisconnect: () => {
      connected = false;
    },
    onStompError: () => {
      connected = false;
    },
    onWebSocketClose: () => {
      connected = false;
    },
    onWebSocketError: () => {
      connected = false;
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
