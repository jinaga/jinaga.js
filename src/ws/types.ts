export type ControlKeyword = "BOOK" | "ERR" | "SUB" | "UNSUB";

export interface ControlFrame {
  keyword: ControlKeyword;
  payload: string[];
}

export interface ProtocolMessageRouterCallbacks {
  onGraphLine: (line: string) => void;
}