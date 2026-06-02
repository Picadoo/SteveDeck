# 性能说明与优化

## 引擎（Node + mineflayer）

| 措施 | 说明 |
|---|---|
| 单进程多机器人 | 所有机器人共享同一进程的 `minecraft-data` 缓存，避免每个 bot 重复加载，内存占用低。 |
| 错误隔离 | 每个 bot 操作 try-catch 包裹，单个崩溃不影响其他；全局 `uncaughtException`/`unhandledRejection` 兜底。 |
| 低 viewDistance | 默认 `short`（区块数据是单 bot 内存大头）；可按 bot 在 `settings.viewDistance` 调为 `tiny/normal/far` 或数字。 |
| 状态推送去重 | `BotInstance.updateStatus` 按「坐标(取整)+生命+饥饿+等级+模块」生成签名，**仅在变化时推送**，静止挂机最多 30s 保活一次，避免每 2s 空推。 |
| 日志合并 | 聊天/系统消息 100ms 防抖合并为一次推送，防止刷屏占用带宽与渲染。 |
| 重连退避 | 指数退避（×1.5，封顶），避免断线时反复猛连拖垮服务器。 |
| 内存监控 | 每 30s 采样，RSS 超过 3GB 告警（为 4G 主机留 1G 余量）。 |
| 原子写盘 | 配置写临时文件后 rename，防止写入中断损坏。 |

### 4G 内存主机指引
- 单进程模型下，离线挂机型机器人每个约几十~百余 MB（取决于 viewDistance 与服务器区块复杂度）。
- 建议：viewDistance 保持 `short/tiny`；同服多机器人时利用启动错峰（已内置，按 host 每 1.5s 一个）。
- 观察 `docker logs` 中的内存日志；接近 3GB 告警时减少机器人数或降低 viewDistance。

### 度量方法
```bash
curl -s http://<engine>/health    # uptime / version
# 容器内存：docker stats mcbot-engine
```

## 客户端（Tauri + React）

| 措施 | 说明 |
|---|---|
| Tauri/WebView2 | 安装包 ~3.2MB、复用系统 WebView，内存占用远低于 Electron（无捆绑 Chromium）。 |
| 日志封顶 | 每个机器人前端最多保留 500 行日志，超出滚动丢弃，内存有界。 |
| Vendor 分包 | React / socket.io-client / 图标各自独立 chunk，应用更新时只失效 ~36KB 应用包，第三方库长期缓存。 |
| 选择性订阅 | zustand 按状态切片订阅，状态变更只重渲染相关组件。 |
| 增量状态 | 引擎只在机器人状态变化时推送，客户端按 id 局部更新。 |

### 构建产物（gzip）
- 应用包 `index.js`：~12KB
- `vendor-react`：~43KB ｜ `vendor-net`：~13KB ｜ `vendor-icons`：~6KB
- CSS：~4KB

## 后续可选优化
- 日志超长时引入虚拟滚动（当前 500 行封顶已足够流畅）。
- 引擎 `findByUsername` 在机器人极多时可加 username→config 索引（当前玩家级规模无需）。
