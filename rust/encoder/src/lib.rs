mod ffmpeg_stdin;
mod codec;

pub use codec::resolve_video_codec;
pub use ffmpeg_stdin::{EncoderError, EncoderStartOptions, FfmpegStdinEncoder};
