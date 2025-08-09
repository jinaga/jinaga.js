export type ControlKeyword = "BOOK" | "ERR" | "SUB" | "UNSUB";

export interface ControlFrame {
  keyword: ControlKeyword;
  payload: string[];
}

export interface ProtocolMessageRouterCallbacks {
  onGraphLine: (line: string) => void;
}

export interface AuthorizationContext {
  userIdentity?: {
    provider: string;
    id: string;
  } | null;
  metadata?: Record<string, unknown>;
}