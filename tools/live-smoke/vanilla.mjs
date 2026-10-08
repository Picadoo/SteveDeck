// 本地 vanilla 测试服生命周期管理：下载官方 server.jar（一次）、写配置、启动等就绪、停止。
// 供 run.mjs 使用；产物全部落 .run/（gitignore），CI 上由 actions/cache 缓存 jar。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.run');
const SERVER_DIR = path.join(RUN_DIR, 'vanilla');
const JAR = path.join(SERVER_DIR, 'server.jar');

// Mojang 官方 1.20.4 服务端（piston-data 内容寻址，URL 即版本指纹）；Java 17+ 可跑，mineflayer 4.33 完整支持
const JAR_URL = 'https://piston-data.mojang.com/v1/objects/8dd1a28015f51b1803213892b50b7b4fc76e594d/server.jar';
const JAR_SIZE = 49150256;

export const MC_PORT = 25568;
export const MC_VERSION = '1.20.4';

/** 确保 server.jar 与配置就位（jar 缺失或大小不符则重新下载）。 */
export async function ensureServerFiles() {
    mkdirSync(SERVER_DIR, { recursive: true });
    const ok = existsSync(JAR) && statSync(JAR).size === JAR_SIZE;
    if (!ok) {
        console.log(`  [vanilla] 下载官方服务端 ${MC_VERSION}（约 47MB，仅首次）…`);
        const res = await fetch(JAR_URL);
        if (!res.ok) throw new Error(`server.jar 下载失败: HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length !== JAR_SIZE) throw new Error(`server.jar 大小不符: ${buf.length} != ${JAR_SIZE}`);
        await writeFile(JAR, buf);
    }
    writeFileSync(path.join(SERVER_DIR, 'eula.txt'), 'eula=true\n');
    writeFileSync(path.join(SERVER_DIR, 'server.properties'), [
        `server-port=${MC_PORT}`,
        'online-mode=false',
        'level-type=minecraft\\:flat',
        'difficulty=peaceful',
        'gamemode=survival',
        'max-players=5',
        'view-distance=4',
        'simulation-distance=4',
        'spawn-protection=0',
        'enforce-secure-profile=false',
        'motd=SteveDeck live-smoke',
        '',
    ].join('\n'));
}

/** 清掉上次的世界（每次全新生成，避免状态漂移；二次生成超平坦约 2-5 秒）。 */
export function resetWorld() {
    rmSync(path.join(SERVER_DIR, 'world'), { recursive: true, force: true });
}

/**
 * 启动服务端，等到 "Done (x.xxx s)!" 才 resolve。
 * @returns {{ stop: () => Promise<void> }}
 */
export function startServer({ timeoutMs = 180000 } = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn('java', ['-Xms256M', '-Xmx1024M', '-jar', 'server.jar', 'nogui'], {
            cwd: SERVER_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let ready = false;
        let out = '';
        const fail = (msg) => { if (!ready) { ready = true; try { proc.kill(); } catch { /* ignore */ } reject(new Error(msg)); } };
        const timer = setTimeout(() => fail(`vanilla 启动超时（${timeoutMs / 1000}s）。尾部输出：\n${out.slice(-800)}`), timeoutMs);

        const stop = () => new Promise((res) => {
            if (proc.exitCode != null) return res();
            // exit 后再等半拍：session.lock 等文件句柄释放，避免紧接着的重启报「文件被占用」
            proc.once('exit', () => setTimeout(res, 500));
            if (process.platform === 'win32') {
                // Windows：proc.kill 对 java 不可靠（实测锁未释放）→ taskkill 杀整棵进程树
                try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); }
                catch { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }
            } else {
                try { proc.kill('SIGKILL'); } catch { /* ignore */ }
            }
            setTimeout(res, 8000); // 兜底放行：8s 未见 exit 也返回（后续启动失败会另行报错）
        });

        const onData = (d) => {
            out += d.toString();
            if (!ready && /Done \(/.test(out)) {
                ready = true;
                clearTimeout(timer);
                resolve({ stop, proc });
            }
        };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.once('exit', (code) => fail(`vanilla 提前退出（code=${code}）。尾部输出：\n${out.slice(-800)}`));
        proc.once('error', (e) => fail(`vanilla 启动失败: ${e.message}（需要 Java 17+ 在 PATH）`));
    });
}
