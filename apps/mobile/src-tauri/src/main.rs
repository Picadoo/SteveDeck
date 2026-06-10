// 安卓入口实际走 lib.rs 的 mobile_entry_point；main.rs 仅供桌面端调试运行
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    stevedeck_mobile_lib::run()
}
