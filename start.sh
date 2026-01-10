#!/bin/bash
APP_DIR="/Users/Zhuanz/Claude Code/BatteryManager"
PORT=3000

if lsof -ti:$PORT > /dev/null 2>&1; then
    open "http://localhost:$PORT"
else
    cd "$APP_DIR"
    npm start &
    sleep 2
    open "http://localhost:$PORT"
fi
