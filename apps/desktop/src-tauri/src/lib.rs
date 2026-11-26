#[cfg(desktop)]
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
#[cfg(desktop)]
use tauri_plugin_autostart::ManagerExt;

#[cfg(desktop)]
use std::sync::Mutex;

// ===================== 内置引擎（仅桌面） =====================
// 桌面版把 Node 引擎（engine-bundle：stevedeck-engine.exe + dist + 生产依赖）作为资源随包打进去，
// 应用启动时在本机回环拉起、退出/更新前杀掉并等待句柄释放；前端在 Tauri 内调用 engine_info 自动连接。
#[cfg(desktop)]
struct EngineState {
    mode: String, // "builtin" | "remote"
    url: String,
    token: String,
    error: Mutex<Option<String>>,
    child: Mutex<Option<std::process::Child>>,
}

// 前端（Tauri 内）调用：返回引擎模式、地址、令牌与启动错误（若内置引擎已提前退出则立即上报）
#[cfg(desktop)]
#[tauri::command]
fn engine_info(state: tauri::State<EngineState>) -> serde_json::Value {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(child) = guard.as_mut() {
            if let Ok(Some(status)) = child.try_wait() {
                *guard = None;
                if let Ok(mut err) = state.error.lock() {
                    if err.is_none() {
                        *err = Some(format!(
                            "内置引擎启动后意外退出（{}），请查看数据目录下的 engine.log",
                            status
                        ));
                    }
                }
            }
        }
    }
    let error = state.error.lock().ok().and_then(|e| e.clone());
    serde_json::json!({
        "mode": state.mode,
        "url": state.url,
        "token": state.token,
        "error": error
    })
}

// 更新安装前由前端调用：同步结束内置引擎并等待退出，释放 Windows 文件锁（避免 NSIS 覆盖失败）
#[cfg(desktop)]
#[tauri::command]
fn stop_engine(app: tauri::AppHandle) {
    kill_engine(&app);
}

// 引擎来源配置文件（AppData/engine-config.json）：{ mode: "builtin"|"remote", url, token }
#[cfg(desktop)]
fn engine_config_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|p| p.join("engine-config.json"))
}

// 读「远程引擎」配置：仅当 mode=remote 且 url 非空时返回 (url, token)，否则 None（走内置）
#[cfg(desktop)]
fn load_remote_engine(app: &tauri::AppHandle) -> Option<(String, String)> {
    let p = engine_config_path(app)?;
    let txt = std::fs::read_to_string(p).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    if v.get("mode").and_then(|m| m.as_str()) == Some("remote") {
        let url = v.get("url").and_then(|u| u.as_str()).unwrap_or("").trim().to_string();
        let token = v.get("token").and_then(|t| t.as_str()).unwrap_or("").trim().to_string();
        if !url.is_empty() {
            return Some((url, token));
        }
    }
    None
}

// 前端读当前引擎来源配置（用于设置面板回填）
#[cfg(desktop)]
#[tauri::command]
fn get_engine_config(app: tauri::AppHandle) -> serde_json::Value {
    if let Some(p) = engine_config_path(&app) {
        if let Ok(txt) = std::fs::read_to_string(p) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                return v;
            }
        }
    }
    serde_json::json!({ "mode": "builtin", "url": "", "token": "" })
}

// 前端写引擎来源配置（重启后生效）
#[cfg(desktop)]
#[tauri::command]
fn set_engine_config(app: tauri::AppHandle, mode: String, url: String, token: String) -> Result<(), String> {
    // DESK-4：mode 白名单校验，避免大小写/拼写错误（"Remote"）静默回退内置而无反馈
    if mode != "builtin" && mode != "remote" {
        return Err(format!("无效的引擎模式: {}", mode));
    }
    let p = engine_config_path(&app).ok_or_else(|| "无法定位配置目录".to_string())?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?; // 不再静默忽略目录创建失败
    }
    let v = serde_json::json!({ "mode": mode, "url": url, "token": token });
    let body = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?; // 序列化失败上抛，不写空串
    std::fs::write(&p, body).map_err(|e| e.to_string())
}

// 重启应用（切换引擎来源或更新后调用以生效）
#[cfg(desktop)]
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    kill_engine(&app); // DESK-1：app.restart() 不触发 RunEvent::Exit，先显式杀内置引擎并等待退出
    // DESK-8：app.restart() 与单实例锁有竞态——新进程启动时旧进程还没释放锁，
    // 新实例被单实例插件当成「第二个实例」直接退出，表现为「点了立即重启后应用直接消失」。
    // Windows 上改为：由分离的辅助进程等待当前 PID 彻底退出后再拉起新实例，路径经环境变量传入防转义/空格/% 坑。
    #[cfg(windows)]
    {
        if let Ok(exe) = std::env::current_exe() {
            use std::os::windows::process::CommandExt;
            let pid = std::process::id();
            let mut ps = std::process::Command::new("powershell.exe");
            ps.args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &format!(
                    "Wait-Process -Id {} -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; Start-Process -FilePath $env:STEVEDECK_EXE",
                    pid
                ),
            ])
            .env("STEVEDECK_EXE", &exe)
            .creation_flags(0x0800_0000); // CREATE_NO_WINDOW：不闪黑窗
            if ps.spawn().is_err() {
                let mut helper = std::process::Command::new("cmd");
                helper.raw_arg(format!("/C ping -n 3 127.0.0.1 >NUL & start \"\" \"{}\"", exe.display()));
                helper.creation_flags(0x0800_0000);
                let _ = helper.spawn();
            }
        }
        app.exit(0);
    }
    #[cfg(not(windows))]
    app.restart();
}

// 前端调用：发系统通知（窗口收进托盘后，bot 死亡/被踢/掉线等关键事件用户才看得见）。
// 走自定义命令而非把 notification 插件暴露给 JS——省 capability 配置，也不依赖前端打包插件 API。
#[cfg(desktop)]
#[tauri::command]
fn notify_user(app: tauri::AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

// 让系统分配一个空闲端口（绑 127.0.0.1:0 拿到端口后立刻释放给引擎用）
#[cfg(desktop)]
fn pick_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        // DESK-7：仅当绑 :0 失败(极罕见)时的兜底端口；正常路径用系统分配的随机端口并经 PORT 传给引擎。
        // 引擎自身默认端口是协议常量 DEFAULT_ENGINE_PORT=8723（此处 8137 与之无关、无需对齐）。
        .unwrap_or(8137)
}

// 剥掉 Windows 的 \\?\ 扩展路径前缀（普通盘符路径无需前缀，避免 Node/Express 路径解析异常）
#[cfg(desktop)]
fn strip_verbatim_prefix(p: std::path::PathBuf) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        let s = p.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            if !rest.starts_with(r"UNC\") {
                return std::path::PathBuf::from(rest);
            }
        }
    }
    p
}

// 在引擎包目录内查找运行时可执行文件：优先专属进程名（便于安装/更新期精准结束、不碰系统 node.exe），兼容旧名 node.exe
#[cfg(desktop)]
fn find_engine_binary(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    let names = ["stevedeck-engine.exe", "node.exe"];
    #[cfg(not(windows))]
    let names = ["stevedeck-engine", "node"];
    for name in names {
        let p = dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

// 定位引擎包：打包后在 resources/engine-bundle；开发期回退到 apps/desktop/engine-bundle
#[cfg(desktop)]
fn locate_engine_bundle(app: &tauri::AppHandle) -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    if let Ok(res) = app.path().resource_dir() {
        let p = strip_verbatim_prefix(res.join("engine-bundle"));
        if let Some(bin) = find_engine_binary(&p) {
            return Some((p, bin));
        }
    }
    let dev = strip_verbatim_prefix(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("engine-bundle"),
    );
    if let Some(bin) = find_engine_binary(&dev) {
        return Some((dev, bin));
    }
    None
}

// 拉起内置引擎进程，总是返回 EngineState（启动失败时把错误写入 error 字段，前端可立即反馈而非干等 20s）
#[cfg(desktop)]
fn spawn_engine(app: &tauri::AppHandle) -> EngineState {
    let (bundle, bin) = match locate_engine_bundle(app) {
        Some(found) => found,
        None => {
            let msg = "未找到内置引擎包（engine-bundle），请重新安装 SteveDeck 或切换远程引擎".to_string();
            eprintln!("[engine] {}", msg);
            return EngineState {
                mode: "builtin".to_string(),
                url: String::new(),
                token: String::new(),
                error: Mutex::new(Some(msg)),
                child: Mutex::new(None),
            };
        }
    };
    let port = pick_free_port();
    let token = uuid::Uuid::new_v4().to_string();
    // 数据（机器人配置/脚本/令牌）落在用户 AppData，可写且随用户保留
    let app_data = app.path().app_data_dir().ok();
    let data_dir = app_data
        .as_ref()
        .map(|p| p.join("engine-data"))
        .unwrap_or_else(|| bundle.join("data"));
    let _ = std::fs::create_dir_all(&data_dir);

    let mut cmd = std::process::Command::new(&bin);
    cmd.current_dir(&bundle)
        .arg("dist/bin/serve.js")
        .env("PORT", port.to_string())
        .env("ENGINE_TOKEN", &token)
        .env("ENGINE_HOST", "127.0.0.1") // 仅本机回环，不暴露局域网
        .env("MCBOT_DATA_DIR", &data_dir)
        .env("MCBOT_PARENT_PID", std::process::id().to_string()); // 父进程看门狗：宿主崩溃时引擎自杀
    // 生产包是 windows_subsystem="windows" 无控制台：把 stdout/stderr 重定向到 engine.log，崩溃可排查
    if let Some(log_path) = app_data.as_ref().map(|p| p.join("engine.log")) {
        if let Ok(out_file) = std::fs::File::create(&log_path) {
            if let Ok(err_file) = out_file.try_clone() {
                cmd.stdout(std::process::Stdio::from(out_file))
                    .stderr(std::process::Stdio::from(err_file));
            }
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW：不弹黑色控制台窗
    }
    match cmd.spawn() {
        Ok(child) => {
            println!("[engine] 内置引擎已启动于 127.0.0.1:{}", port);
            EngineState {
                mode: "builtin".to_string(),
                url: format!("http://127.0.0.1:{}", port),
                token,
                error: Mutex::new(None),
                child: Mutex::new(Some(child)),
            }
        }
        Err(e) => {
            let msg = format!("内置引擎启动失败（可能被安全软件拦截）：{}", e);
            eprintln!("[engine] {}", msg);
            EngineState {
                mode: "builtin".to_string(),
                url: String::new(),
                token: String::new(),
                error: Mutex::new(Some(msg)),
                child: Mutex::new(None),
            }
        }
    }
}

// 退出/更新/重启时杀掉内置引擎并同步等待其彻底退出，避免残留进程和 Windows 文件锁
#[cfg(desktop)]
fn kill_engine(handle: &tauri::AppHandle) {
    if let Some(state) = handle.try_state::<EngineState>() {
        if let Ok(mut guard) = state.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            // 单实例锁必须最先注册：双击两次图标 = 两个进程 + 两个内置引擎写同一个
            // AppData/engine-data/bots.json 互相覆盖。第二实例启动时唤起已有窗口后自动退出。
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }))
            .plugin(tauri_plugin_notification::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))
            .invoke_handler(tauri::generate_handler![
                engine_info,
                stop_engine,
                get_engine_config,
                set_engine_config,
                restart_app,
                notify_user
            ])
            .setup(|app| {
                // 引擎来源：配置为「远程」则不起内置引擎、直接用远程地址；否则起内置（失败不致命，写入 error）
                let engine_state = match load_remote_engine(app.handle()) {
                    Some((url, token)) => {
                        println!("[engine] 使用远程引擎: {}", url);
                        EngineState {
                            mode: "remote".to_string(),
                            url,
                            token,
                            error: Mutex::new(None),
                            child: Mutex::new(None),
                        }
                    }
                    None => spawn_engine(app.handle()),
                };
                app.manage(engine_state);

                let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
                let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
                let autostart =
                    CheckMenuItem::with_id(app, "autostart", "开机自启", true, autostart_on, None::<&str>)?;
                let autostart_menu = autostart.clone();
                let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &autostart, &quit])?;

                let mut tray = TrayIconBuilder::with_id("main")
                    .tooltip("SteveDeck")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                        "autostart" => {
                            let mgr = app.autolaunch();
                            if mgr.is_enabled().unwrap_or(false) {
                                let _ = mgr.disable();
                            } else {
                                let _ = mgr.enable();
                            }
                            let _ = autostart_menu.set_checked(mgr.is_enabled().unwrap_or(false));
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                    });
                // DESK-5：图标缺失（打包回归/损坏）时优雅降级，不在启动路径 unwrap panic（配 panic=abort 会崩在启动）
                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }
                tray.build(app)?;
                Ok(())
            })
            .on_window_event(|window, event| {
                // 关闭窗口 = 最小化到托盘（继续后台运行）
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let _ = window.hide();
                    api.prevent_close();
                    // 首次收托盘弹一次系统通知——不少用户以为点 X 就退出了，其实机器人还在挂机
                    use std::sync::atomic::{AtomicBool, Ordering};
                    static TRAY_HINTED: AtomicBool = AtomicBool::new(false);
                    if !TRAY_HINTED.swap(true, Ordering::Relaxed) {
                        use tauri_plugin_notification::NotificationExt;
                        let _ = window
                            .app_handle()
                            .notification()
                            .builder()
                            .title("SteveDeck 仍在运行")
                            .body("已最小化到托盘，机器人继续挂机。点击托盘图标可重新打开窗口。")
                            .show();
                    }
                }
            });
    }

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|_handle, _event| {
        // 应用真正退出时清掉内置引擎子进程
        #[cfg(desktop)]
        if let tauri::RunEvent::Exit = _event {
            kill_engine(_handle);
        }
    });
}
