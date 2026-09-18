#!/usr/bin/env bash
# Mở ui-next ra Internet bằng ngrok RIÊNG của project này (xem README §Expose ra ngoài).
#
# ngrok trỏ THẲNG vào PORT của app: không có reverse proxy đứng trước, NEXT_PUBLIC_BASE_PATH=""
# và app phục vụ ở gốc `/`.
#
#   ./scripts/ngrok.sh              # dùng PORT + NGROK_* trong .env
#   ./scripts/ngrok.sh 5000         # ghi đè cổng
#
# Dừng: Ctrl-C (hoặc `pm2 stop ai-agent-ngrok` nếu chạy qua pm2).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HERE/.env"
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"

die() { echo "ERROR: $*" >&2; exit 1; }

command -v ngrok >/dev/null || die "chưa cài ngrok (https://ngrok.com/download)"
[ -f "$ENV_FILE" ] || die "thiếu $ENV_FILE — copy từ .env.example rồi điền NGROK_DOMAIN"

# Đọc .env mà không eval cả file: chỉ lấy đúng các khoá cần, bỏ nháy bao ngoài.
get() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | tail -1 | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'; }

TOKEN="$(get NGROK_AUTHTOKEN)"
DOMAIN="$(get NGROK_DOMAIN)"
BASIC="$(get UI_BASIC_AUTH)"
WEB_ADDR="$(get NGROK_WEB_ADDR)"
PORT="${1:-$(get PORT)}"
PORT="${PORT:-5000}"

# Gác cổng: app mở ra Internet mà không có Basic Auth thì ai có link cũng chạy được agent với quyền
# sửa file trên máy này. Chặn ở đây thay vì để người dùng tự nhớ.
if [ -z "$BASIC" ]; then
  die "UI_BASIC_AUTH trống — đặt \"user:pass\" trong .env trước khi mở ra ngoài"
fi

# App phải đang chạy, nếu không ngrok dựng tunnel tới cổng chết và người mở link thấy 502. Chờ tối đa
# NGROK_WAIT giây (mặc định 45) thay vì chết ngay: chạy qua pm2 thì ngrok và app khởi động song song,
# ngrok thường lên trước.
WAIT="${NGROK_WAIT:-45}"
# Chấp nhận cả 401/403: app bật UI_BASIC_AUTH thì /api/healthz trả 401 — vẫn là app đang sống.
up=0
for _ in $(seq 1 "$WAIT"); do
  code="$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/healthz" || true)"
  case "$code" in 200|401|403) up=1; break;; esac
  sleep 1
done
[ "$up" = 1 ] || die "cổng $PORT không lên sau ${WAIT}s — chạy \`npm run dev\` (hoặc pm2 start) trước"

# Máy chạy NHIỀU agent ngrok cùng lúc được (mỗi project một account/authtoken), nhưng 2 thứ phải khác
# nhau giữa các agent:
#   1. Endpoint. Agent không truyền --url sẽ lấy static domain mặc định của account trong config;
#      domain đó đang online ở agent khác → ERR_NGROK_334 "endpoint is already online".
#   2. Web inspector, mặc định bind 127.0.0.1:4040 — agent thứ hai đụng cổng. ngrok v3 KHÔNG có flag
#      --web-addr, chỉ đặt được trong config file, nên script sinh config tạm với `web_addr`.
#      NGROK_WEB_ADDR trống: lấy 4040 nếu còn rảnh, bận thì tắt inspector.
if [ -z "$WEB_ADDR" ]; then
  if command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q "127.0.0.1:4040 "; then
    WEB_ADDR="false"   # 4040 bận (agent ngrok khác) → tắt inspector cho agent này
    echo "· cổng 4040 đang bận (agent ngrok khác) → tắt web inspector cho lần chạy này"
  else
    WEB_ADDR="127.0.0.1:4040"
  fi
fi

# Config tạm (schema v3: authtoken/web_addr nằm trong khối `agent:`), xoá khi thoát.
CONF="$(mktemp "${TMPDIR:-/tmp}/ngrok-uinext-XXXXXX.yml")"
trap 'rm -f "$CONF"' EXIT
umask 077
CONFIGS=(--config "$CONF")
EXTRA=()
[ "$WEB_ADDR" = "false" ] && EXTRA=(--inspect=false)

if [ -n "$TOKEN" ]; then
  # Project tự cầm authtoken riêng. Token nằm TRONG file config (chmod 600), KHÔNG truyền qua
  # --authtoken: tham số dòng lệnh hiện ra trong `ps`/`pm2 describe` nên mọi user trên máy đọc được.
  printf 'version: "3"\nagent:\n  authtoken: %s\n' "$TOKEN" > "$CONF"
else
  # Không khai NGROK_AUTHTOKEN → dùng authtoken của config mặc định ~/.config/ngrok/ngrok.yml.
  # ngrok v3 gộp nhiều --config theo thứ tự, nên chỉ cần overlay `web_addr` lên trên, KHÔNG phải
  # sao chép token sang .env của repo (giữ secret ở đúng một chỗ).
  DEFAULT_CONF="$HOME/.config/ngrok/ngrok.yml"
  [ -f "$DEFAULT_CONF" ] || die "không có NGROK_AUTHTOKEN trong .env và cũng không thấy $DEFAULT_CONF"
  printf 'version: "3"\n' > "$CONF"
  CONFIGS=(--config "$DEFAULT_CONF" --config "$CONF")
fi
[ "$WEB_ADDR" != "false" ] && printf 'agent:\n  web_addr: %s\n' "$WEB_ADDR" >> "$CONF"
chmod 600 "$CONF"

echo "ngrok → 127.0.0.1:$PORT${DOMAIN:+  (domain: $DOMAIN)}  · inspector: $WEB_ADDR"
exec ngrok http "$PORT" "${CONFIGS[@]}" ${DOMAIN:+--url "$DOMAIN"} "${EXTRA[@]}"
