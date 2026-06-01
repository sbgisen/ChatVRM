#!/bin/bash
#--------------------------------------------
# ChatVRM Setup Script
#--------------------------------------------

#-----------------------------
#   Functions
#-----------------------------
red=31
green=32
yellow=33
cyan=36
cecho() {
    color=$1
    shift
    echo -e "\e[${color}m$@\e[m"
}

#-----------------------------
#   Check before setup
#-----------------------------
if [ ${EUID:-${UID}} = 0 ]; then
    cecho $red "本スクリプトはrootユーザー以外で実行してください"
    exit 9
fi

echo "本スクリプトはソースコードや環境変数の変更後、"
echo "systemdを再起動したい場合にご利用ください。"

#-----------------------------
#   User Config
#-----------------------------

# passwordの入力を求める
sudo echo

# 待ち受けポート設定
cecho $cyan "待ち受けポートを入力してください。(デフォルト: 3001)"
read -r PORT
PORT=${PORT:-3001}

# 自動起動設定
cecho $cyan "自動起動設定をしますか？"
select select_startup in yes no; do
    break
done
if [ "$select_startup" = "yes" ]; then
    startup=1; startup_out="する"
else
    startup=0; startup_out="しない"
fi

cecho $cyan "以下の設定でインストールします。よろしいですか？(Ctrl+C:キャンセル)"
cecho $yellow "ポート:${PORT}"
cecho $yellow "自動起動:${startup_out}"
read user_ans

#-----------------------------
#   npm build
#-----------------------------
cecho $cyan "[START] npm build"
npm ci
npm run build
cecho $cyan "[COMPLETED] npm build"

#-----------------------------
#   systemd setting
#-----------------------------
cecho $cyan "[START] systemd setting"

SERVICE_NAME=chatvrm
SERVICE_FILE=/etc/systemd/system/${SERVICE_NAME}.service
WORK_DIR="/home/$USER/work/ChatVRM"
ENV_FILE="${WORK_DIR}/.env"
FNM_BIN="/home/$USER/.local/share/fnm/fnm"

if [ ! -f "$ENV_FILE" ]; then
    cecho $yellow ".env が見つかりません。.env.example をコピーして作成します：${ENV_FILE}"
    cp "${WORK_DIR}/.env.example" "$ENV_FILE"
fi

echo "Creating systemd service at： ${SERVICE_FILE}"

sudo tee ${SERVICE_FILE} > /dev/null <<EOF
[Unit]
Description=ChatVRM Service (Next.js, Node.js v22 via fnm)
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$WORK_DIR
ExecStart=$FNM_BIN exec --using 22 npx next start -p $PORT
EnvironmentFile=$ENV_FILE
Environment="NODE_ENV=production"
Environment="PORT=$PORT"
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "Reloading systemd daemon..."
sudo systemctl daemon-reload

if [ $startup = 1 ]; then
    echo "Enabling and starting ${SERVICE_NAME}"
    sudo systemctl enable ${SERVICE_NAME}
    sudo systemctl restart ${SERVICE_NAME}
else
    echo "Disabling and stop ${SERVICE_NAME}"
    sudo systemctl disable ${SERVICE_NAME}
    sudo systemctl stop ${SERVICE_NAME}
fi
echo "Done. Service status:"
sudo systemctl status ${SERVICE_NAME} --no-pager

cecho $cyan "[COMPLETED] systemd setting"

if [ $startup = 0 ]; then
    cecho $green "下記のコマンドで開発モードが起動します。"
    cecho $green "npm run dev"
fi
