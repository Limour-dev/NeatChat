#!/bin/bash
# 快速重部署脚本 - 关chrome、停服务、构建、启动、验证
set -e
cd /home/limour/NeatChat

echo "==> 关闭 chrome-use..."
chrome-use close 2>/dev/null || true

echo "==> 停止旧服务..."
PID=$(ss -tlnp | grep :3000 | grep -oP 'pid=\K[0-9]+' || true)
if [ -n "$PID" ]; then
  kill $PID
  sleep 2
fi

echo "==> 构建 (--no-lint)..."
rm -rf .next
./node_modules/.bin/next build --no-lint

echo "==> 启动..."
export PORT=3000
unset __NEXT_PRIVATE_ORIGIN
nohup ./node_modules/.bin/next start -p 3000 > /tmp/neatchat-server.log 2>&1 &

echo "==> 等待服务就绪..."
for i in $(seq 1 15); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q 200; then
    echo "==> ✓ 服务已就绪 (http://localhost:3000)"
    ss -tlnp | grep :3000
    exit 0
  fi
  sleep 1
done

echo "==> ✗ 服务启动超时"
tail -20 /tmp/neatchat-server.log
exit 1
