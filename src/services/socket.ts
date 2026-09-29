import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import { normalizeApiStatus, normalizeMobile, type PanditApiStatus } from "./api";
import { isSameOriginUrl, resolveSockJsUrl } from "../lib/upstream";

const WS_EVENT = "pandit-dashboard-ws-status";
const SOCKJS_PATH = import.meta.env.VITE_PANDIT_WS_URL || "/api/ws";
const STATUS_TOPIC = "/topic/pandit/status";
const RECONNECT_MS = 8_000;

export type WsStatusPayload = {
  mobile: string;
  status: PanditApiStatus;
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
