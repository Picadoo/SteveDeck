const fs = require('fs');
const path = require('path');

const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

class Logger {
    constructor() {
        this.level = LOG_LEVELS[process.env.LOG_LEVEL || 'INFO'];
        this.logDir = path.join(__dirname, '../logs');

        // 创建日志目录
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    _getTimestamp() {
        return new Date().toISOString();
    }

    _formatMessage(level, message, ...args) {
        const timestamp = this._getTimestamp();
        const formatted = `[${timestamp}] [${level}] ${message}`;

        if (args.length > 0) {
            return formatted + ' ' + args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' ');
        }

        return formatted;
    }

    _writeToFile(level, formattedMessage) {
        const date = new Date().toISOString().split('T')[0];
        const logFile = path.join(this.logDir, `${date}.log`);

        fs.appendFile(logFile, formattedMessage + '\n', (err) => {
            if (err) console.error('日志写入失败:', err);
        });

        // 错误单独记录
        if (level === 'ERROR') {
            const errorFile = path.join(this.logDir, `${date}-error.log`);
            fs.appendFile(errorFile, formattedMessage + '\n', () => {});
        }
    }

    error(message, ...args) {
        if (this.level >= LOG_LEVELS.ERROR) {
            const formatted = this._formatMessage('ERROR', message, ...args);
            console.error('\x1b[31m%s\x1b[0m', formatted);
            this._writeToFile('ERROR', formatted);
        }
    }

    warn(message, ...args) {
        if (this.level >= LOG_LEVELS.WARN) {
            const formatted = this._formatMessage('WARN', message, ...args);
            console.warn('\x1b[33m%s\x1b[0m', formatted);
            this._writeToFile('WARN', formatted);
        }
    }

    info(message, ...args) {
        if (this.level >= LOG_LEVELS.INFO) {
            const formatted = this._formatMessage('INFO', message, ...args);
            console.log('\x1b[36m%s\x1b[0m', formatted);
            this._writeToFile('INFO', formatted);
        }
    }

    debug(message, ...args) {
        if (this.level >= LOG_LEVELS.DEBUG) {
            const formatted = this._formatMessage('DEBUG', message, ...args);
            console.log('\x1b[90m%s\x1b[0m', formatted);
            this._writeToFile('DEBUG', formatted);
        }
    }

    // 日志轮转（删除30天前的日志）
    rotateLogs(daysToKeep = 30) {
        fs.readdir(this.logDir, (err, files) => {
            if (err) return;

            const now = Date.now();
            files.forEach(file => {
                const filePath = path.join(this.logDir, file);
                fs.stat(filePath, (err, stats) => {
                    if (err) return;

                    const age = (now - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
                    if (age > daysToKeep) {
                        fs.unlink(filePath, () => {});
                    }
                });
            });
        });
    }
}

const logger = new Logger();

// 每天运行一次日志轮转（unref：后台维护定时器不应阻止进程退出/测试结束）
const _rotateTimer = setInterval(() => {
    logger.rotateLogs();
}, 24 * 60 * 60 * 1000);
if (_rotateTimer.unref) _rotateTimer.unref();

module.exports = logger;
