// 全局变量
let historyChart = null;

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    loadBatteryInfo();
    loadHistory();
    loadUsageStats();

    // 每 30 秒刷新电池信息
    setInterval(loadBatteryInfo, 30000);
});

// 显示 Toast 消息
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 加载电池信息
async function loadBatteryInfo() {
    try {
        const response = await fetch('/api/battery');
        const data = await response.json();

        // 更新电池电量显示
        const batteryLevel = document.getElementById('batteryLevel');
        const batteryPercent = document.getElementById('batteryPercent');

        batteryLevel.style.width = `${data.stateOfCharge}%`;
        batteryPercent.textContent = `${data.stateOfCharge}%`;

        // 低电量样式
        if (data.stateOfCharge < 20) {
            batteryLevel.classList.add('low');
        } else {
            batteryLevel.classList.remove('low');
        }

        // 充电动画
        if (data.isCharging) {
            batteryLevel.classList.add('charging');
        } else {
            batteryLevel.classList.remove('charging');
        }

        // 更新充电状态
        const chargingStatus = document.getElementById('chargingStatus');
        if (data.fullyCharged) {
            chargingStatus.innerHTML = '<span class="status-icon">✅</span><span class="status-text">已充满</span>';
            chargingStatus.classList.add('charging');
        } else if (data.isCharging) {
            chargingStatus.innerHTML = '<span class="status-icon">⚡</span><span class="status-text">正在充电</span>';
            chargingStatus.classList.add('charging');
        } else {
            chargingStatus.innerHTML = '<span class="status-icon">🔋</span><span class="status-text">使用电池</span>';
            chargingStatus.classList.remove('charging');
        }

        // 更新信息卡片
        document.getElementById('cycleCount').textContent = data.cycleCount;
        document.getElementById('maxCapacity').textContent = `${data.maxCapacity}%`;
        document.getElementById('chargeLimit').textContent = `${data.chargeLimit}%`;

        // 更新 mAh 容量
        document.getElementById('designCapacity').textContent = `${data.designCapacityMah} mAh`;
        document.getElementById('maxCapacityMah').textContent = `${data.maxCapacityMah} mAh`;
        document.getElementById('healthCapacity').textContent = `${data.healthCapacityMah} mAh`;

    } catch (error) {
        console.error('加载电池信息失败:', error);
        showToast('加载电池信息失败', 'error');
    }
}

// 复制充电命令到剪贴板
async function copyChargeCommand(limit) {
    // 使用 battery 工具（适配 Apple Silicon）
    const command = limit === 100
        ? `battery maintain stop`
        : `battery maintain ${limit}`;

    try {
        await navigator.clipboard.writeText(command);
        showToast(`📋 命令已复制，请粘贴到终端执行`, 'success');

        // 更新显示的充电上限（预期值）
        document.getElementById('chargeLimit').textContent = `${limit}%`;

    } catch (error) {
        // 降级处理：显示命令让用户手动复制
        showToast(`复制失败，请手动复制: ${command}`, 'error');
        console.error('复制失败:', error);
    }
}

// 设置充电上限（保留但不再使用）
async function setChargeLimit(limit) {
    try {
        showToast(`正在设置充电上限为 ${limit}%...`, 'success');

        const response = await fetch('/api/charge-limit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit })
        });

        const data = await response.json();

        if (data.success) {
            showToast(`✅ 充电上限已设置为 ${limit}%`, 'success');
            document.getElementById('chargeLimit').textContent = `${limit}%`;
        } else {
            throw new Error(data.error || '设置失败');
        }

    } catch (error) {
        console.error('设置充电上限失败:', error);
        showToast('❌ 设置失败，请在终端手动执行 sudo 命令', 'error');
    }
}

// 记录当前数据
async function recordData() {
    try {
        const response = await fetch('/api/record', { method: 'POST' });
        const data = await response.json();

        showToast(`✅ 已记录: 循环 ${data.cycleCount} 次, 容量 ${data.maxCapacityMah} mAh`, 'success');
        loadHistory();

    } catch (error) {
        console.error('记录数据失败:', error);
        showToast('❌ 记录失败', 'error');
    }
}

// 加载历史记录
async function loadHistory() {
    try {
        const response = await fetch('/api/history');
        const data = await response.json();

        updateChart(data.records);
        updateTable(data.records);

    } catch (error) {
        console.error('加载历史记录失败:', error);
    }
}

// 更新图表
function updateChart(records) {
    const ctx = document.getElementById('historyChart').getContext('2d');

    // 最多显示最近 30 条记录
    const recentRecords = records.slice(-30);

    const labels = recentRecords.map(r => {
        const date = new Date(r.date);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    });

    const cycleData = recentRecords.map(r => r.cycleCount);
    const capacityData = recentRecords.map(r => r.maxCapacityMah || r.maxCapacity);

    if (historyChart) {
        historyChart.destroy();
    }

    historyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '当前容量 (mAh)',
                    data: capacityData,
                    borderColor: '#00d68f',
                    backgroundColor: 'rgba(0, 214, 143, 0.1)',
                    fill: true,
                    tension: 0.4,
                    yAxisID: 'y'
                },
                {
                    label: '循环次数',
                    data: cycleData,
                    borderColor: '#0095ff',
                    backgroundColor: 'rgba(0, 149, 255, 0.1)',
                    fill: true,
                    tension: 0.4,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#8888aa',
                        usePointStyle: true,
                        padding: 16
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#2a2a3a' },
                    ticks: { color: '#8888aa' }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: '#2a2a3a' },
                    ticks: {
                        color: '#00d68f',
                        callback: v => v + ' mAh'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#0095ff' }
                }
            }
        }
    });
}

// 更新表格
function updateTable(records) {
    const tbody = document.querySelector('#historyTable tbody');

    // 按日期倒序显示
    const sortedRecords = [...records].reverse();

    tbody.innerHTML = sortedRecords.map(r => `
        <tr>
            <td>${r.date}</td>
            <td>${r.cycleCount}</td>
            <td>${r.maxCapacityMah || r.maxCapacity}</td>
            <td>${r.realCapacityMah || '-'}</td>
        </tr>
    `).join('');
}

// 格式化分钟为小时:分钟
function formatMinutes(minutes) {
    if (minutes < 60) {
        return `${minutes}分`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}时${mins}分` : `${hours}时`;
}

// 加载使用统计
async function loadUsageStats() {
    try {
        const response = await fetch('/api/usage-stats');
        const data = await response.json();

        const tbody = document.querySelector('#usageTable tbody');

        // 按日期倒序显示
        const sortedData = [...data].reverse();

        tbody.innerHTML = sortedData.map(r => `
            <tr>
                <td>${r.date.slice(5)}</td>
                <td>${formatMinutes(r.batteryMinutes)}</td>
                <td>${formatMinutes(r.acMinutes)}</td>
                <td>${r.chargeUsed}%</td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('加载使用统计失败:', error);
    }
}
