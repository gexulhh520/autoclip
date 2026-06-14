use autoclip_export::{ExportFinishOptions, ExportSessionManager, ExportStartOptions};
use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;

const WIDTH: u32 = 608;
const HEIGHT: u32 = 1080;
const FPS: f64 = 30.0;
const FRAME_COUNT: u32 = 120;

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn ffprobe_duration(path: &PathBuf) -> Option<f64> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()?
        .trim()
        .parse()
        .ok()
}

fn synthetic_frame(frame_index: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (WIDTH * HEIGHT * 4) as usize];
    let tint = 48 + (frame_index % 8) as u8;
    for chunk in rgba.chunks_mut(4) {
        chunk[0] = tint;
        chunk[1] = tint;
        chunk[2] = tint + 8;
        chunk[3] = 255;
    }
    rgba
}

#[test]
fn export_smoke_encodes_playable_mp4() {
    if !ffmpeg_available() {
        eprintln!("SKIP: ffmpeg not available");
        return;
    }

    let dir = std::env::temp_dir().join(format!("autoclip-export-smoke-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("mkdir");
    let output = dir.join("compositor_smoke.mp4");

    let manager = ExportSessionManager::default();
    let (session_id, _) = manager
        .start(ExportStartOptions {
            output_path: output.to_string_lossy().into_owned(),
            width: WIDTH,
            height: HEIGHT,
            fps: FPS,
            total_frames: FRAME_COUNT,
        })
        .expect("start export");

    let started = Instant::now();
    for frame in 0..FRAME_COUNT {
        manager
            .push_frame(&session_id, &synthetic_frame(frame))
            .expect("push frame");
    }
    let encode_ms = started.elapsed().as_millis();

    let (path, progress) = manager
        .finish(
            &session_id,
            ExportFinishOptions {
                output_path: output.to_string_lossy().into_owned(),
            },
        )
        .expect("finish export");

    assert_eq!(progress.frame, FRAME_COUNT);
    assert!(path.is_file());
    assert!(path.metadata().expect("metadata").len() > 1024);

    let duration = ffprobe_duration(&path).expect("ffprobe duration");
    assert!(
        (duration - 4.0).abs() < 0.25,
        "expected ~4s video, got {duration}s"
    );

    println!(
        "EXPORT_SMOKE encode_ms={encode_ms} frames={FRAME_COUNT} duration_sec={duration:.3} bytes={}",
        path.metadata().expect("metadata").len()
    );

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn export_bench_reports_encode_throughput() {
    if !ffmpeg_available() {
        eprintln!("SKIP: ffmpeg not available");
        return;
    }
    if std::env::var("COMPOSITOR_BENCHMARK").ok().as_deref() != Some("1") {
        return;
    }

    let frame_count: u32 = std::env::var("BENCHMARK_FRAMES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(FRAME_COUNT);

    let dir = std::env::temp_dir().join(format!("autoclip-export-bench-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("mkdir");
    let output = dir.join("compositor_bench.mp4");

    let manager = ExportSessionManager::default();
    let (session_id, _) = manager
        .start(ExportStartOptions {
            output_path: output.to_string_lossy().into_owned(),
            width: WIDTH,
            height: HEIGHT,
            fps: FPS,
            total_frames: frame_count,
        })
        .expect("start export");

    let started = Instant::now();
    for frame in 0..frame_count {
        manager
            .push_frame(&session_id, &synthetic_frame(frame))
            .expect("push frame");
    }
    let (path, _) = manager
        .finish(
            &session_id,
            ExportFinishOptions {
                output_path: output.to_string_lossy().into_owned(),
            },
        )
        .expect("finish export");
    let wall_ms = started.elapsed().as_millis();
    let fps_actual = frame_count as f64 / (wall_ms as f64 / 1000.0);

    println!(
        "{{\"component\":\"encoder\",\"frames\":{frame_count},\"width\":{WIDTH},\"height\":{HEIGHT},\"wall_ms\":{wall_ms},\"fps\":{fps_actual:.2},\"bytes\":{}}}",
        path.metadata().expect("metadata").len()
    );

    let _ = std::fs::remove_dir_all(dir);
}
