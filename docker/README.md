# 引擎 Docker 部署

在一台 7×24 常开主机（VPS 或家用小主机）上运行引擎。

## 构建并启动

```bash
# 在仓库根目录
docker compose -f docker/docker-compose.yml up -d --build

# 查看连接信息（地址 + 访问令牌 + 连接串 + 二维码提示）
docker logs mcbot-engine
```

首次启动会自动生成访问令牌并持久化到数据卷 `mcbot-data:/data/token`。
客户端（Windows / Android）填入「引擎地址 + 令牌」或扫码即可遥控。

## 固定令牌（可选）

在 `docker-compose.yml` 的 `environment` 取消注释并设置 `ENGINE_TOKEN`。

## 数据持久化

机器人配置、令牌、脚本都存放在数据卷 `/data`，容器重建不丢。

## 安全建议（公网暴露）

- 不要用默认端口直接裸暴露；建议放在反向代理（Caddy/Nginx）后启用 TLS（`wss://`）。
- 令牌务必足够随机（自动生成的即可）。
- 可配合防火墙限制来源 IP。

> 注意：当前开发机未安装 Docker，镜像构建尚未在本地实测；请在具备 Docker 的环境执行上面的命令完成验证。
