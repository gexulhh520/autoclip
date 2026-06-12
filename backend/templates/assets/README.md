# 模板预览静态资源

- `golden_quote_cinema.svg` — 金句电影感列表封面（poster）
- `knowledge_digest.svg` — 知识口播列表封面（poster）
- `golden_quote_cinema_preview.mp4` — 金句模板卡片循环预览视频
- `knowledge_digest_preview.mp4` — 知识口播卡片循环预览视频

前端通过 `GET /api/v1/templates/assets/{filename}` 访问；`preview.video_url` / `preview.thumbnail_url` 在 JSON 里写相对路径即可。

预览 MP4 可用 ffmpeg 重新生成，例如：

```bash
ffmpeg -y -f lavfi -i color=c=0xF5F5F4:s=640x360:d=4 \
  -vf "drawtext=text='Golden Quote Cinema':fontsize=22:fontcolor=0x1C1917:x=(w-text_w)/2:y=(h-text_h)/2" \
  -c:v libx264 -pix_fmt yuv420p golden_quote_cinema_preview.mp4
```
