const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化历史文件
if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({ records: [] }, null, 2));
}

// MIME 类型映射
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json'
};

// 获取电池信息
async function getBatteryInfo() {
    try {
        // 使用 ioreg 获取详细电池信息（包含真实 mAh 数据）
        const { stdout: ioregOut } = await execAsync('ioreg -r -c AppleSmartBattery');
        const { stdout: profilerOut } = await execAsync('system_profiler SPPowerDataType');

        const info = {
            cycleCount: 0,
            maxCapacity: 0,           // 健康度百分比
            maxCapacityMah: 0,        // 真实当前最大容量 mAh (ioreg)
            healthCapacityMah: 0,     // 健康度计算容量 = 设计容量 × 健康度%
            designCapacityMah: 0,     // 设计容量 mAh
            currentCapacityMah: 0,    // 当前剩余容量 mAh
            stateOfCharge: 0,
            isCharging: false,
            fullyCharged: false,
            chargeLimit: 100
        };

        // 从 ioreg 解析真实容量 (mAh)
        const designMatch = ioregOut.match(/"DesignCapacity"\s*=\s*(\d+)/);
        if (designMatch) info.designCapacityMah = parseInt(designMatch[1]);

        const rawMaxMatch = ioregOut.match(/"AppleRawMaxCapacity"\s*=\s*(\d+)/);
        if (rawMaxMatch) info.maxCapacityMah = parseInt(rawMaxMatch[1]);

        const rawCurrentMatch = ioregOut.match(/"AppleRawCurrentCapacity"\s*=\s*(\d+)/);
        if (rawCurrentMatch) info.currentCapacityMah = parseInt(rawCurrentMatch[1]);

        const cycleMatch = ioregOut.match(/"CycleCount"\s*=\s*(\d+)/);
        if (cycleMatch) info.cycleCount = parseInt(cycleMatch[1]);

        // 从 system_profiler 解析其他信息
        const capacityMatch = profilerOut.match(/Maximum Capacity:\s*(\d+)%/);
        if (capacityMatch) info.maxCapacity = parseInt(capacityMatch[1]);

        // 计算健康度对应容量 = 设计容量 × 健康度%
        info.healthCapacityMah = Math.round(info.designCapacityMah * info.maxCapacity / 100);

        const chargeMatch = profilerOut.match(/State of Charge \(%\):\s*(\d+)/);
        if (chargeMatch) info.stateOfCharge = parseInt(chargeMatch[1]);

        const chargingMatch = profilerOut.match(/Charging:\s*(\w+)/);
        if (chargingMatch) info.isCharging = chargingMatch[1].toLowerCase() === 'yes';

        const fullMatch = profilerOut.match(/Fully Charged:\s*(\w+)/);
        if (fullMatch) info.fullyCharged = fullMatch[1].toLowerCase() === 'yes';

        // 获取 battery 工具充电限制状态
        try {
            const { stdout: batteryOut } = await execAsync('battery status 2>/dev/null || echo ""');
            // 解析 battery status 输出: "maintained at 80%"
            const maintainMatch = batteryOut.match(/maintained at (\d+)%/i);
            if (maintainMatch) {
                info.chargeLimit = parseInt(maintainMatch[1]);
            } else {
                info.chargeLimit = 100;
            }
        } catch (e) {
            info.chargeLimit = 100;
        }

        return info;
    } catch (error) {
        console.error('获取电池信息失败:', error);
        throw error;
    }
}

// 获取每日电池使用统计
async function getDailyUsageStats() {
    try {
        // 获取最近 7 天的 pmset 日志
        const { stdout } = await execAsync('pmset -g log | grep -E "Using (Batt|AC).*Charge:" | tail -500');

        const lines = stdout.split('\n').filter(l => l.trim());
        const dailyStats = {};

        for (const line of lines) {
            // 解析日期和电量
            // 格式: 2026-01-10 00:14:22 +0800 ... Using Batt(Charge: 80)
            const dateMatch = line.match(/^(\d{4}-\d{2}-\d{2})/);
            const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
            const chargeMatch = line.match(/Charge[:\s]*(\d+)/);
            const sourceMatch = line.match(/Using (Batt|AC)/);

            if (dateMatch && timeMatch && chargeMatch && sourceMatch) {
                const date = dateMatch[1];
                const time = timeMatch[1];
                const charge = parseInt(chargeMatch[1]);
                const source = sourceMatch[1]; // Batt 或 AC

                if (!dailyStats[date]) {
                    dailyStats[date] = {
                        date,
                        batteryUsageMinutes: 0,
                        acUsageMinutes: 0,
                        chargeStart: charge,
                        chargeEnd: charge,
                        chargeUsed: 0,
                        events: []
                    };
                }

                dailyStats[date].events.push({ time, charge, source });
                dailyStats[date].chargeEnd = charge;
            }
        }

        // 计算每天的使用时间和电量消耗
        const result = [];
        for (const date of Object.keys(dailyStats).sort()) {
            const stats = dailyStats[date];
            const events = stats.events;
            let totalChargeUsed = 0;

            // 计算使用时间和电池消耗
            for (let i = 1; i < events.length; i++) {
                const prev = new Date(events[i - 1].time);
                const curr = new Date(events[i].time);
                const minutes = (curr - prev) / 60000;

                if (minutes > 0 && minutes < 120) { // 忽略超过2小时的间隔（睡眠）
                    if (events[i - 1].source === 'Batt') {
                        stats.batteryUsageMinutes += minutes;
                        // 电池模式下电量下降才计入消耗
                        const drain = events[i - 1].charge - events[i].charge;
                        if (drain > 0) {
                            totalChargeUsed += drain;
                        }
                    } else {
                        stats.acUsageMinutes += minutes;
                    }
                }
            }

            result.push({
                date: stats.date,
                batteryMinutes: Math.round(stats.batteryUsageMinutes),
                acMinutes: Math.round(stats.acUsageMinutes),
                chargeUsed: totalChargeUsed
            });
        }

        return result.slice(-7); // 返回最近7天
    } catch (error) {
        console.error('获取使用统计失败:', error);
        return [];
    }
}



// 设置充电限制
async function setChargeLimit(limit) {
    try {
        await execAsync(`sudo bclm write ${limit}`);
        await execAsync('sudo bclm persist');
        return { success: true, limit };
    } catch (error) {
        console.error('设置充电限制失败:', error);
        throw error;
    }
}

// 读取历史记录
function getHistory() {
    try {
        const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        return { records: [] };
    }
}

// 添加历史记录
async function addRecord() {
    const info = await getBatteryInfo();
    const history = getHistory();

    const today = new Date().toISOString().split('T')[0];

    // 检查今天是否已有记录
    const existingIndex = history.records.findIndex(r => r.date === today);

    const record = {
        date: today,
        cycleCount: info.cycleCount,
        maxCapacity: info.maxCapacity,
        maxCapacityMah: info.healthCapacityMah,  // 健康度计算容量
        realCapacityMah: info.maxCapacityMah,    // 真实容量
        designCapacityMah: info.designCapacityMah,
        stateOfCharge: info.stateOfCharge,
        timestamp: new Date().toISOString()
    };

    if (existingIndex >= 0) {
        history.records[existingIndex] = record;
    } else {
        history.records.push(record);
    }

    // 按日期排序
    history.records.sort((a, b) => new Date(a.date) - new Date(b.date));

    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    return record;
}

// 处理静态文件
function serveStatic(res, filePath) {
    const ext = path.extname(filePath);
    const mimeType = MIME_TYPES[ext] || 'text/plain';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeType });
        res.end(data);
    });
}

// 处理 API 请求
async function handleAPI(req, res, pathname) {
    res.setHeader('Content-Type', 'application/json');

    try {
        if (req.method === 'GET' && pathname === '/api/battery') {
            const info = await getBatteryInfo();
            res.writeHead(200);
            res.end(JSON.stringify(info));

        } else if (req.method === 'POST' && pathname === '/api/charge-limit') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { limit } = JSON.parse(body);
                    const result = await setChargeLimit(limit);
                    res.writeHead(200);
                    res.end(JSON.stringify(result));
                } catch (error) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: error.message }));
                }
            });

        } else if (req.method === 'GET' && pathname === '/api/history') {
            const history = getHistory();
            res.writeHead(200);
            res.end(JSON.stringify(history));

        } else if (req.method === 'POST' && pathname === '/api/record') {
            const record = await addRecord();
            res.writeHead(200);
            res.end(JSON.stringify(record));

        } else if (req.method === 'GET' && pathname === '/api/usage-stats') {
            const stats = await getDailyUsageStats();
            res.writeHead(200);
            res.end(JSON.stringify(stats));

        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not Found' }));
        }
    } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
    }
}

// 创建服务器
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // API 路由
    if (pathname.startsWith('/api/')) {
        return handleAPI(req, res, pathname);
    }

    // 静态文件
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);

    serveStatic(res, filePath);
});

server.listen(PORT, () => {
    console.log(`🔋 电池管理服务已启动: http://localhost:${PORT}`);
    console.log('按 Ctrl+C 停止服务');
});
