# 部署 mc-bot-player 引擎(含网页客户端)到腾讯云服务器 — 在仓库根目录运行
# 用法: .\docker\deploy-tencent.ps1            # 默认广东服务器
#       .\docker\deploy-tencent.ps1 -Server seoul
#
# 打包用 git archive：只含已跟踪文件 → 自动排除 .test-data(明文密码)/.env/node_modules/dist。
# 首次部署在服务器生成强随机 ENGINE_TOKEN 存入 ~/mc-bot-player/.engine-env(chmod 600)，重复部署沿用。
param(
  [ValidateSet("guangdong", "seoul")] [string]$Server = "guangdong"
)
$ErrorActionPreference = "Stop"

$cfg = @{
  guangdong = @{ HostIp = "119.91.120.244"; User = "ubuntu"; Key = "$env:USERPROFILE\.ssh\tencent_cloud" }
  seoul     = @{ HostIp = "43.128.143.73";  User = "root";   Key = "$env:USERPROFILE\.ssh\tencent_seoul" }
}[$Server]
$ssh = "$($cfg.User)@$($cfg.HostIp)"
$key = $cfg.Key

Write-Host "== 打包(git archive, 只含已跟踪文件) =="
git archive HEAD -o mcbot-deploy.tar.gz
try {
  Write-Host "== 上传到 $ssh =="
  ssh -i $key $ssh "mkdir -p ~/mc-bot-player"
  scp -i $key mcbot-deploy.tar.gz "${ssh}:~/mc-bot-player/"

  Write-Host "== 解包 + 准备令牌 + 构建启动 =="
  ssh -i $key $ssh @'
set -e
cd ~/mc-bot-player
tar xzf mcbot-deploy.tar.gz && rm mcbot-deploy.tar.gz
# 令牌只生成一次（幂等重部署不换令牌，已配对设备不掉线）
if [ ! -f .engine-env ]; then
  echo "ENGINE_TOKEN=$(openssl rand -hex 24)" > .engine-env
  chmod 600 .engine-env
  echo "[deploy] 已生成新 ENGINE_TOKEN（存于 ~/mc-bot-player/.engine-env）"
fi
cd docker
docker compose --env-file ../.engine-env up -d --build
'@

  Write-Host "== 等待健康检查 =="
  Start-Sleep -Seconds 12
  ssh -i $key $ssh "curl -sf http://127.0.0.1:8723/health && echo '' && curl -sf -o /dev/null -w 'web client: HTTP %{http_code}\n' -H 'Accept: text/html' http://127.0.0.1:8723/"

  Write-Host ""
  Write-Host "完成。下一步："
  Write-Host "  1) 腾讯云控制台安全组放行 TCP 8723（建议仅放行你常用的出口 IP）"
  Write-Host "  2) 取连接信息: ssh -i $key $ssh 'source ~/mc-bot-player/.engine-env && curl -s -H \"Authorization: Bearer `$ENGINE_TOKEN\" http://127.0.0.1:8723/api/connection-info'"
  Write-Host "  3) 手机浏览器打开 http://$($cfg.HostIp):8723/ 粘贴连接串即用"
} finally {
  Remove-Item mcbot-deploy.tar.gz -ErrorAction SilentlyContinue
}
