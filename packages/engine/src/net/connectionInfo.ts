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
  /** 引擎是否同时提供网页客户端（决定二维码编码成哪种载荷） */
  uiServed?: boolean;
}): Promise<ConnectionInfo> {
  const addresses = listAddresses();
  // ENGINE_PUBLIC_HOST：容器/NAT 后面网卡上只有内网 IP，连接串/二维码必须用外界可达地址。
  // 部署脚本会把服务器公网 IP 写进 .engine-env；不设则维持原行为（取第一块非回环网卡）。
  const publicHost = process.env.ENGINE_PUBLIC_HOST?.trim();
  const primary = publicHost || addresses[0] || "127.0.0.1";
  if (publicHost && !addresses.includes(publicHost)) addresses.unshift(publicHost);
  const connectionString = buildConnectionString(primary, opts.port, opts.token);
  // 网页直开地址：系统相机扫码 → 浏览器打开 → 前端读 #mcbot= 自动连接（零安装配对）。
  // 连接串放 hash：不进 HTTP 请求行/服务器日志；前端读取后立即从地址栏清除。
  const webUrl = `http://${primary}:${opts.port}/#mcbot=${encodeURIComponent(connectionString)}`;
  let qrcodeDataUrl: string | undefined;
  try {
    // 引擎带网页客户端 → 二维码编码网页地址（手机相机即扫即用，App 也能从 #mcbot= 提取连接串）；
    // 不带（如桌面内置 bundle）→ 保持纯连接串（仅供客户端 App 解析）。
    qrcodeDataUrl = await QRCode.toDataURL(opts.uiServed ? webUrl : connectionString);
  } catch {
    /* 二维码生成失败不致命 */
  }
  return {
    engineVersion: opts.version,
    protocolVersion: PROTOCOL_VERSION,
    addresses,
    port: opts.port,
    connectionString,
    webUrl: opts.uiServed ? webUrl : undefined,
    qrcodeDataUrl,
  };
}
