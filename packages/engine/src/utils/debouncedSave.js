const fs = require('fs').promises;
const path = require('path');

class DebouncedFileSaver {
    /**
     * 创建防抖文件保存器
     * @param {string} filePath - 文件路径
     * @param {number} delay - 防抖延迟(毫秒)，默认2000ms
     */
    constructor(filePath, delay = 2000) {
        this.filePath = filePath;
        this.delay = delay;
        this.pendingData = null;
        this.saveTimer = null;
        this.isSaving = false;
        this.saveCount = 0;
    }

    /**
     * 保存数据（防抖）
     * @param {any} data - 要保存的数据
     */
    async save(data) {
        this.pendingData = data;

        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }

        this.saveTimer = setTimeout(() => {
            this.flush();
        }, this.delay);
    }

    /**
     * 立即写入文件
     */
    async flush() {
        if (this.isSaving || !this.pendingData) return;

        this.isSaving = true;
        const dataToSave = this.pendingData;
        this.pendingData = null;

        try {
            const jsonString = JSON.stringify(dataToSave, null, 2);
            await fs.writeFile(this.filePath, jsonString, 'utf8');
            this.saveCount++;

            // 使用简单的console.log避免循环依赖
            const fileName = path.basename(this.filePath);
            console.log(`[文件保存] ${fileName} (第${this.saveCount}次)`);
        } catch (err) {
            console.error(`[文件保存失败] ${this.filePath}:`, err.message);
            // 如果保存失败，恢复数据以便重试
            this.pendingData = dataToSave;
        } finally {
            this.isSaving = false;
        }
    }

    /**
     * 强制立即保存（用于程序退出时）
     * @returns {Promise<void>}
     */
    async forceFlush() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        await this.flush();
    }

    /**
     * 获取保存统计信息
     * @returns {{saveCount: number, hasPending: boolean}}
     */
    getStats() {
        return {
            saveCount: this.saveCount,
            hasPending: this.pendingData !== null
        };
    }
}

module.exports = DebouncedFileSaver;
