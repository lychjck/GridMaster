#!/usr/bin/env bash
# deploy.sh - 构建前后端并部署到服务器
set -euo pipefail

# ============ 配置 ============
SERVER="ubuntu@yinglian.site"
REMOTE_BASE="/var/www/wangge"
REMOTE_BACKEND="${REMOTE_BASE}/src/backend"
REMOTE_FRONTEND="${REMOTE_BASE}/frontend"

# 项目根目录（脚本所在目录的上一级）
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# SSL 证书本地路径和远程路径
LOCAL_CERTS="${PROJECT_ROOT}/scripts/yinglian.site_nginx"
REMOTE_SSL="/etc/nginx/ssl"

# ============ 解析参数 ============
DEPLOY_FRONTEND=true
DEPLOY_BACKEND=true
DEPLOY_CERTS=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --frontend-only) DEPLOY_BACKEND=false; shift ;;
        --backend-only)  DEPLOY_FRONTEND=false; shift ;;
        --with-certs)    DEPLOY_CERTS=true; shift ;;
        --certs-only)    DEPLOY_FRONTEND=false; DEPLOY_BACKEND=false; DEPLOY_CERTS=true; shift ;;
        -h|--help)
            echo "用法: bash scripts/deploy.sh [选项]"
            echo ""
            echo "选项:"
            echo "  --frontend-only   只部署前端"
            echo "  --backend-only    只部署后端"
            echo "  --with-certs      同时上传 SSL 证书"
            echo "  --certs-only      只上传 SSL 证书"
            echo "  -h, --help        显示帮助"
            exit 0
            ;;
        *) error "未知参数: $1" ;;
    esac
done

# ============ 构建前端 ============
if $DEPLOY_FRONTEND; then
    info "构建前端..."
    cd "${PROJECT_ROOT}/frontend"
    npm install --silent
    npm run build
    info "前端构建完成"
    cd "${PROJECT_ROOT}"
fi

# ============ 构建后端 ============
if $DEPLOY_BACKEND; then
    info "交叉编译后端 (linux/amd64)..."
    cd "${PROJECT_ROOT}/backend"
    GOOS=linux GOARCH=amd64 go build -o wangge-backend .
    info "后端编译完成"
    cd "${PROJECT_ROOT}"
fi

# ============ 上传文件 ============
if $DEPLOY_FRONTEND; then
    info "上传前端文件..."
    ssh "$SERVER" "mkdir -p ${REMOTE_FRONTEND}/dist"
    rsync -az --delete "${PROJECT_ROOT}/frontend/dist/" "${SERVER}:${REMOTE_FRONTEND}/dist/"
    info "前端上传完成"
fi

if $DEPLOY_BACKEND; then
    info "停止后端服务..."
    ssh "$SERVER" "sudo systemctl stop wangge || true"
    info "上传后端二进制..."
    ssh "$SERVER" "mkdir -p ${REMOTE_BACKEND}"
    scp "${PROJECT_ROOT}/backend/wangge-backend" "${SERVER}:${REMOTE_BACKEND}/wangge-backend"
    info "后端上传完成"
fi

# 同步 Nginx 配置
info "上传 Nginx 配置..."
scp "${PROJECT_ROOT}/scripts/nginx_wangge.conf" "${SERVER}:/tmp/nginx_wangge.conf"
ssh "$SERVER" "sudo cp /tmp/nginx_wangge.conf /etc/nginx/sites-available/wangge.conf && sudo ln -sf /etc/nginx/sites-available/wangge.conf /etc/nginx/sites-enabled/wangge.conf && rm /tmp/nginx_wangge.conf"
info "Nginx 配置上传完成"
NGINX_CHANGED=true

if $DEPLOY_CERTS; then
    info "上传 SSL 证书..."
    ssh "$SERVER" "sudo mkdir -p ${REMOTE_SSL}"
    scp "${LOCAL_CERTS}/yinglian.site_bundle.crt" "${SERVER}:/tmp/yinglian.site_bundle.crt"
    scp "${LOCAL_CERTS}/yinglian.site.key" "${SERVER}:/tmp/yinglian.site.key"
    ssh "$SERVER" "sudo mv /tmp/yinglian.site_bundle.crt ${REMOTE_SSL}/yinglian.site_bundle.crt && sudo mv /tmp/yinglian.site.key ${REMOTE_SSL}/yinglian.site.key && sudo chmod 600 ${REMOTE_SSL}/yinglian.site.key"
    info "SSL 证书上传完成"
fi

# ============ 重启服务 ============
if $DEPLOY_BACKEND; then
    info "重启后端服务..."
    ssh "$SERVER" "sudo systemctl restart wangge"
    # 等待 2 秒后检查状态
    sleep 2
    if ssh "$SERVER" "systemctl is-active --quiet wangge"; then
        info "后端服务运行正常 ✓"
    else
        warn "后端服务可能未正常启动，请检查: ssh ${SERVER} 'journalctl -u wangge -n 20'"
    fi
fi

if $DEPLOY_CERTS || ${NGINX_CHANGED:-false}; then
    info "重载 Nginx..."
    ssh "$SERVER" "sudo nginx -t && sudo systemctl reload nginx"
    info "Nginx 重载完成 ✓"
fi

info "部署完成 🎉"
