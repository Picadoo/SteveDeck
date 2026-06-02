import { CommandAck } from "@mcbot/protocol";

export type Ack = (res: CommandAck) => void;

export function ok<T>(data?: T): CommandAck<T> {
  return { ok: true, data };
}

export function fail(error: string): CommandAck {
  return { ok: false, error };
}
