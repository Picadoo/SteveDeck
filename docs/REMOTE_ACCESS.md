# 远程访问 / 内网穿透

引擎跑在家里常开主机（Windows，NAT 后面、没有公网 IP），想用手机在外网遥控时看这篇。

**什么时候需要**：家里有台 7×24 常开主机跑 SteveDeck 引擎，但它在路由器 NAT 后面、运营商不给公网 IP，你又想在外面用手机连。这时需要一台**有公网 IP 的中转机**（你的云服务器 / Linux VPS，或一台 Windows 服务器）。

**一句话总览**：把家里引擎的 `8723` + `8800-8803` 反向隧道到中转机，手机连中转机的公网 IP 即可。

## 一、要穿透哪些端口

| 端口 | 用途 | 必须放行？ |
|------|------|-----------|
| `8723` | 控制面（HTTP/WS）+ 内置网页客户端 `http://host:8723/` | 是 |
| `8800-8803` | 实时 3D 视角（每个机器人一个独立 web 服务，默认 4 个） | 想看实时视角则必须 |

- **全功能**：转发 `8723` + `8800-8803`，共 **5 个端口**。
- **只要控制、不看 3D 视角**：只转发 `8723` 即可，除实时视角外全部可用。
- 视角端口池大小由 `ENGINE_VIEWER_PORTS` 决定（默认 4，可设 2~54）。**改了池大小，隧道/防火墙放行的端口区间也要同步改**（如设 8 则放行 `8800-8807`）。

> 视角 iframe 的地址 = `http://<你连接引擎用的那个 host>:88XX`，即和控制面同一个 host、不同端口。所以中转机必须把这几个视角端口也一并转发，手机才看得到画面。

## 二、方法 A（推荐）：中转机是 Linux，用 Windows 内置 SSH 反向隧道

家里 PC 主动向中转机建一条 SSH 反向隧道，把本机端口反向映射到中转机的公网端口。

### 前提

- Win10/11 自带 OpenSSH 客户端，**无需装额外软件**（`ssh -V` 能输出版本即可）。
- 引擎保持默认 `ENGINE_HOST=127.0.0.1`（最安全，隧道在本机回环侧接入，**不要**改成 `0.0.0.0`）。
- 设 `ENGINE_PUBLIC_HOST=<中转机公网IP>`，让引擎打印的连接串 / 二维码指向中转机。
- 中转机 `sshd` 开 `GatewayPorts yes`，否则反向端口只绑 `127.0.0.1`、外部连不上：

```bash
# 中转机上执行
echo 'GatewayPorts yes' | sudo tee -a /etc/ssh/sshd_config
sudo systemctl restart sshd
```

- 云**安全组**放行 TCP `8723` 和 `8800-8803`。

### 家里 PC：建反向隧道（PowerShell）

OpenSSH 的 `-R` **不支持端口区间**，所以用循环逐个把端口拼成参数：

```powershell
$Relay = "203.0.113.10"          # 中转机公网 IP（占位，替换成你的）
$User  = "ubuntu"                # 中转机 SSH 用户
$Key   = "$HOME\.ssh\id_ed25519" # 你的私钥
$Ports = @(8723) + (8800..8803)  # 控制面 + 视角端口池

$rargs = foreach ($p in $Ports) { "-R"; "0.0.0.0:${p}:127.0.0.1:${p}" }
ssh -N -i $Key @rargs "$User@$Relay"
```

### 手机连接

浏览器打开 `http://<中转机IP>:8723/`，把引擎打印的连接串（`mcbot://<中转机IP>:8723?token=...`）粘进「引擎地址 / 连接串」框即可，令牌会自动带入。

## 三、方法 B：中转机是 Windows 服务器

### 在 Windows 服务器装 OpenSSH Server

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service sshd -StartupType Automatic
```

开 `GatewayPorts`（否则反向端口只绑回环）：在 `C:\ProgramData\ssh\sshd_config` 加一行 `GatewayPorts yes`，然后：

```powershell
Restart-Service sshd
```

放行防火墙（5 个端口一条规则）：

```powershell
New-NetFirewallRule -DisplayName "SteveDeck Remote" -Direction Inbound `
  -Protocol TCP -LocalPort 8723,8800-8803 -Action Allow
```

### 家里 PC

用**方法 A 完全相同**的反向隧道命令，把 `$Relay` 换成这台 Windows 服务器的公网 IP、`$User` 换成它的账户即可。

### 附注：无 NAT 的同网转发（不是穿透）

如果引擎其实跑在内网另一台机器上、而这台 Windows 服务器**本身有公网 IP 且与引擎同一局域网**（中间不存在 NAT），可以用 Windows 内置 `netsh` 直接做端口转发，不需要 SSH 隧道：

```powershell
# 把本机 8723 转发到内网引擎机 192.168.1.50:8723（视角端口同理逐个加）
netsh interface portproxy add v4tov4 `
  listenaddress=0.0.0.0 listenport=8723 `
  connectaddress=192.168.1.50 connectport=8723
```

这是「同网转发」场景，**不是内网穿透**——前提是这台机器有公网 IP 且能直连引擎机。

## 四、让隧道稳定常驻

隧道要能断线自动重连，并开机自启。

### 自动重连包装脚本

存为 `C:\SteveDeck\tunnel.ps1`：

```powershell
$Relay = "203.0.113.10"
$User  = "ubuntu"
$Key   = "$HOME\.ssh\id_ed25519"
$Ports = @(8723) + (8800..8803)
$rargs = foreach ($p in $Ports) { "-R"; "0.0.0.0:${p}:127.0.0.1:${p}" }

while ($true) {
  ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes `
      -i $Key @rargs "$User@$Relay"
  Start-Sleep -Seconds 5   # 断了等 5 秒重连
}
```

### 注册为开机自启（任务计划程序）

```powershell
$Action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -File C:\SteveDeck\tunnel.ps1"
$Trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "SteveDeck Tunnel" `
  -Action $Action -Trigger $Trigger -RunLevel Highest
```

> `autossh` 在 Windows 无原生版本；上面的 `while` 重连脚本即可替代。想做成真正的 Windows 服务可用 **NSSM** 把 `tunnel.ps1` 包成服务。

## 五、安全

- **只暴露带令牌的端口**：控制面和视角都在令牌鉴权之后。用引擎首次启动自动生成的**强随机令牌**（连接串里的 `?token=...`），别自己设弱令牌。
- 云安全组 / 防火墙尽量**只放行你手机的固定出口 IP**，缩小暴露面。
- PC ↔ 中转机这一跳是 **SSH 加密**的；中转机 ↔ 手机是**明文 http**。
- 视角 iframe 是明文 http：如果把控制面放到 **HTTPS/TLS 反向代理**（如 Caddy）后面，浏览器会以「混合内容」拦掉 http 的视角 iframe。所以：
  - **要看实时视角** → 走明文 http 隧道 + 强令牌 +（可选）来源 IP 白名单。
  - **只要控制面** → 可以上 TLS 反代，但实时 3D 视角会被拦掉。

## 六、其它方案

- **frp**：单可执行文件，自动重连更省心，配置一次长期跑，比手搓 SSH 隧道稳。
- **Tailscale / ZeroTier**：组网式，**不需要公网 IP 和端口转发**，装上就互通——想零配置的最省事。
- **Cloudflare Tunnel**：适合**只暴露控制面**；多端口视角穿透不方便。

## 七、排错

| 现象 | 原因 / 排查 |
|------|------------|
| 手机连不上 | 安全组 / 防火墙没放行 `8723` |
| 连上了但视角黑屏 / 一直转圈 | `8800-8803` 没一起转发或没放行 |
| 反向端口外部连不上 | 中转机 `sshd` 没开 `GatewayPorts yes`（重启 sshd 后再试） |
| 鉴权失败 / 连不上引擎 | 令牌不对，或粘贴时带了多余空白 / 换行 |

> 家里引擎可用 Docker 跑（`docker compose -f docker/docker-compose.yml up -d --build`，令牌看 `docker logs stevedeck-engine`），或 `pnpm start:engine`（Node，令牌打印在终端）。两种都保持 `ENGINE_HOST=127.0.0.1` 给隧道用。
