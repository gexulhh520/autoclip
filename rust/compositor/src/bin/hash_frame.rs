use autoclip_compositor::render_frame;
use autoclip_document::FrameDescriptor;
use sha2::{Digest, Sha256};
use std::{env, fs, process};

fn main() {
    let path = env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: hash_frame <descriptor.json>");
        process::exit(1);
    });
    let json = fs::read_to_string(&path).unwrap_or_else(|error| {
        eprintln!("read failed: {error}");
        process::exit(1);
    });
    let descriptor: FrameDescriptor = serde_json::from_str(&json).unwrap_or_else(|error| {
        eprintln!("parse failed: {error}");
        process::exit(1);
    });
    let rgba = render_frame(&descriptor).unwrap_or_else(|error| {
        eprintln!("render failed: {error}");
        process::exit(1);
    });
    let hash = Sha256::digest(rgba);
    println!("{}", hex::encode(hash));
}
