# 电池管理应用

macOS 电池健康监测 & 充电控制工具（适配 Apple Silicon）

## 功能

- 🔋 **电池状态** - 实时显示电量、充电状态
- 📊 **健康监测** - 循环次数、健康度、真实/健康度容量 (mAh)
- 🛡️ **充电控制** - 一键复制限制 80%/100% 命令
- 📈 **历史记录** - 图表追踪电池容量变化趋势
- ⏱️ **使用统计** - 最近7天电池/电源使用时间和耗电量

## 安装

### 前置要求

- Node.js
- [battery CLI](https://github.com/actuallymentor/battery)（Apple Silicon 充电控制）

```bash
# 安装 battery 工具
curl -s https://raw.githubusercontent.com/actuallymentor/battery/main/setup.sh | bash
```

### 安装应用

```bash
git clone https://github.com/chenkaifu3/BatteryManager.git
cd BatteryManager
npm install
```

## 使用

### 启动

```bash
npm start
```

然后访问 http://localhost:3000

### 一键启动

```bash
./start.sh
```

或添加到 shell 配置：

```bash
alias battery-app='"/path/to/BatteryManager/start.sh"'
```

## 充电控制

点击界面按钮复制命令，然后在终端粘贴执行：

```bash
# 限制充电 80%
battery maintain 80

# 恢复正常充电
battery maintain stop

# 查看状态
battery status
```

## 技术栈

- 前端：HTML + CSS + JavaScript + Chart.js
- 后端：Node.js (原生 HTTP)
- 电池信息：ioreg、system_profiler、pmset
- 充电控制：battery CLI

## 许可证

MIT
