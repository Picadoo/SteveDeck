import * as os from "os";
import QRCode from "qrcode";
import { ConnectionInfo, PROTOCOL_VERSION } from "@mcbot/protocol";

/** 列出可达的 IPv4 地址候选（外网/内网优先，回环兜底）。 */
export function listAddresses(): string[] {
  const addrs: string[] = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) addrs.push(ni.address);
    }
  }
  addrs.push("127.0.0.1");
  return addrs;
}

export function buildConnectionString(host: string, port: number, token: string): string {
  return `mcbot://${host}:${port}?token=${token}`;
}

export async function buildConnectionInfo(opts: {
  version: string;
  port: number;
  token: string;
}): Promise<ConnectionInfo> {
  const addresses = listAddresses();
  const primary = addresses[0] ?? "127.0.0.1";
  const connectionString = buildConnectionString(primary, opts.port, opts.token);
  let qrcodeDataUrl: string | undefined;
  try {
    qrcodeDataUrl = await QRCode.toDataURL(connectionString);
  } catch {
    /* 二维码生成失败不致命 */
  }
  return {
    engineVersion: opts.version,
    protocolVersion: PROTOCOL_VERSION,
    addresses,
    port: opts.port,
    connectionString,
    qrcodeDataUrl,
  };
}
