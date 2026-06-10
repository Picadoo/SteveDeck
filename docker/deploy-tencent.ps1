# 部署 mc-bot-player 引擎(含网页客户端)到腾讯云服务器 — 在仓库根目录运行
# 用法: .\docker\deploy-tencent.ps1             # 默认广东服务器，服务器上构建（增量最快）
#       .\docker\deploy-tencent.ps1 -LocalBuild # 本地构建镜像传上去（2核云机太慢/大改动时用，需先启动 Docker Desktop）
#       .\docker\deploy-tencent.ps1 -Server seoul
#
# 打包用 git archive：只含已跟踪文件 → 自动排除 .test-data(明文密码)/.env/node_modules/dist。
# 首次部署在服务器生成强随机 ENGINE_TOKEN 存入 ~/mc-bot-player/.engine-env(chmod 600)，重复部署沿用。
param(
  [ValidateSet("guangdong", "seoul")] [string]$Server = "guangdong",
  [switch]$LocalBuild
)
$ErrorActionPreference = "Stop"

$cfg = @{
  guangdong = @{ HostIp = "119.91.120.244"; User = "ubuntu"; Key = "$env:USERPROFILE\.ssh\tencent_cloud" }
  seoul     = @{ HostIp = "43.128.143.73";  User = "root";   Key = "$env:USERPROFILE\.ssh\tencent_seoul" }
}[$Server]
$ssh = "$($cfg.User)@$($cfg.HostIp)"
$key = $cfg.Key
# keepalive：构建期 ssh 长时间无输出，没有心跳的话断线/半开连接会无限挂起
$sshOpts = @("-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=8")

if ($LocalBuild) {
  Write-Host "== 本地构建镜像 (linux/amd64) =="
  docker build --platform linux/amd64 -f docker/Dockerfile -t mc-bot-player-engine:latest .
  if ($LASTEXITCODE -ne 0) { throw "本地 docker build 失败" }
}

Write-Host "== 打包(git archive, 只含已跟踪文件) =="
git archive HEAD -o mcbot-deploy.tar.gz
try {
  Write-Host "== 上传到 $ssh =="
  ssh -i $key @sshOpts $ssh "mkdir -p ~/mc-bot-player"
  scp -i $key @sshOpts mcbot-deploy.tar.gz "${ssh}:~/mc-bot-player/"

  if ($LocalBuild) {
    Write-Host "== 传输镜像（gzip 流式，约 100-200MB，取决于上行带宽） =="
    # cmd /c 走二进制管道：PowerShell 自身的管道会把字节流当文本糟蹋掉
    cmd /c "docker save mc-bot-player-engine:latest | gzip | ssh -i `"$key`" -o ServerAliveInterval=15 -o ServerAliveCountMax=8 $ssh `"gunzip | docker load`""
    if ($LASTEXITCODE -ne 0) { throw "镜像传输失败" }
  }

  Write-Host "== 解包 + 准备令牌 + 启动 =="
  $composeUp = if ($LocalBuild) { "docker compose --env-file ../.engine-env up -d --no-build" }
               else             { "docker compose --env-file ../.engine-env up -d --build" }
  $remoteScript = @"
set -e
cd ~/mc-bot-player
tar xzf mcbot-deploy.tar.gz && rm mcbot-deploy.tar.gz
# 令牌只生成一次（幂等重部署不换令牌，已配对设备不掉线）
if [ ! -f .engine-env ]; then
  echo "ENGINE_TOKEN=`$(openssl rand -hex 24)" > .engine-env
  chmod 600 .engine-env
  echo "[deploy] 已生成新 ENGINE_TOKEN（存于 ~/mc-bot-player/.engine-env）"
fi
# 历史部署可能混入 CRLF（PowerShell here-string 行尾）——令牌带 \r 会导致鉴权永远失败
sed -i 's/\r`$//' .engine-env
# 公网地址：连接串/二维码用它（容器网卡上只有内网 IP）；IP 换了也会自动更新
grep -q '^ENGINE_PUBLIC_HOST=' .engine-env && sed -i 's/^ENGINE_PUBLIC_HOST=.*/ENGINE_PUBLIC_HOST=$($cfg.HostIp)/' .engine-env || echo 'ENGINE_PUBLIC_HOST=$($cfg.HostIp)' >> .engine-env
cd docker
$composeUp
"@
  # 剥掉 here-string 的 CR：CRLF 进了远程 bash 会把 \r 写进 .engine-env/文件名（已踩坑）
  ssh -i $key @sshOpts $ssh ($remoteScript -replace "`r", "")

  Write-Host "== 等待健康检查 =="
  Start-Sleep -Seconds 12
  ssh -i $key @sshOpts $ssh "curl -sf http://127.0.0.1:8723/health && echo '' && curl -sf -o /dev/null -w 'web client: HTTP %{http_code}\n' -H 'Accept: text/html' http://127.0.0.1:8723/"
  if ($LASTEXITCODE -ne 0) { throw "健康检查失败：容器没起来或引擎没监听 8723，上服务器 docker logs mcbot-engine 看日志" }

  Write-Host ""
  Write-Host "完成。下一步："
  Write-Host "  1) 腾讯云控制台安全组放行 TCP 8723（建议仅放行你常用的出口 IP）"
  Write-Host "  2) 取连接信息: ssh -i $key $ssh 'source ~/mc-bot-player/.engine-env && curl -s -H \"Authorization: Bearer `$ENGINE_TOKEN\" http://127.0.0.1:8723/api/connection-info'"
  Write-Host "  3) 手机浏览器打开 http://$($cfg.HostIp):8723/ 粘贴连接串即用"
} finally {
  Remove-Item mcbot-deploy.tar.gz -ErrorAction SilentlyContinue
}
