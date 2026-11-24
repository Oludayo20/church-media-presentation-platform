/**
 * @cmp/media-processing — the media import pipeline's file and ffmpeg work
 * (DOCUMENTATION.md §7): sniffing, streamed hash + atomic copy, ffprobe,
 * thumbnails and transcoding. Database-free; it runs inside the
 * `utilityProcess` worker so a crash or a slow file never touches the main
 * process or a live session.
 */
export * from "./sniff";
export * from "./store";
export * from "./ffmpeg";
export * from "./font";
