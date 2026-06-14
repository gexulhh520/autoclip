use autoclip_compositor::render_frame;
use autoclip_document::FrameDescriptor;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};

fn fixtures_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/compositor")
}

fn golden_path(name: &str) -> PathBuf {
    fixtures_root().join("golden").join(name)
}

fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

fn load_descriptor(name: &str) -> FrameDescriptor {
    let json = fs::read_to_string(golden_path(name)).expect("read descriptor fixture");
    serde_json::from_str(&json).expect("parse descriptor")
}

fn filter_layers(mut descriptor: FrameDescriptor) -> FrameDescriptor {
    descriptor.items.retain(|item| matches!(item, autoclip_document::FrameItem::Layer { .. }));
    descriptor
}

fn filter_layers_and_effects(mut descriptor: FrameDescriptor) -> FrameDescriptor {
    descriptor.items.retain(|item| {
        matches!(
            item,
            autoclip_document::FrameItem::Layer { .. } | autoclip_document::FrameItem::SceneEffect { .. }
        )
    });
    descriptor
}

fn assert_golden_hash(descriptor: FrameDescriptor, golden_file: &str) {
    let rgba = render_frame(&descriptor).expect("render");
    let hash = sha256_hex(&rgba);
    let expected = fs::read_to_string(golden_path(golden_file))
        .expect("read golden hash")
        .trim()
        .to_string();
    assert_eq!(hash, expected, "RGBA hash mismatch for {golden_file}");
}

#[test]
fn golden_minimal_frame_t0_layers() {
    assert_golden_hash(
        filter_layers(load_descriptor("minimal-descriptor-t0.json")),
        "minimal-frame-t0-layers.sha256",
    );
}

#[test]
fn golden_dissolve_frame_t_mid_layers() {
    assert_golden_hash(
        filter_layers(load_descriptor("dissolve-descriptor-t-mid.json")),
        "dissolve-frame-t-mid-layers.sha256",
    );
}

#[test]
fn golden_minimal_frame_t0_mono_soft() {
    let mut descriptor = filter_layers(load_descriptor("minimal-descriptor-t0.json"));
    descriptor.items.push(autoclip_document::FrameItem::SceneEffect {
        id: "visual-filter".into(),
        effect_id: "visual_filter.mono_soft".into(),
    });
    assert_golden_hash(descriptor, "minimal-frame-t0-mono-soft.sha256");
}
