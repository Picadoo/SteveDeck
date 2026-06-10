// SteveDeck 安卓壳：纯 WebView 客户端，零自定义命令。
// 前端在 Tauri 环境里会先试 engine_info（桌面内置引擎流程）——此处没有该命令，
// 调用立刻失败回退到「已保存的连接 / 连接页」，正是移动端想要的行为，无需任何桥接代码。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("SteveDeck mobile 启动失败");
}
