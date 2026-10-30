/** Original M4-inspired silhouette. Two cached tread frames; turret drawn separately. */
export function tankSprites(doc: Document) {
  const cache = new Map<string, HTMLCanvasElement[]>();
  return (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    body: number,
    turret: number,
    color: string,
    tread: number,
    recoil: number,
    flash: boolean,
    scale = 1,
  ) => {
    let frames = cache.get(color);
    if (!frames) {
      frames = [0, 1].map((frame) => {
        const tile = doc.createElement("canvas");
        tile.width = 32;
        tile.height = 32;
        const c = tile.getContext("2d")!;
        c.fillStyle = "#151020";
        c.fillRect(3, 5, 26, 7);
        c.fillRect(3, 21, 26, 7);
        c.fillStyle = "#8573ee";
        for (let i = 0; i < 6; i++) {
          c.fillRect(4 + i * 4 + frame, 6, 2, 5);
          c.fillRect(4 + i * 4 + frame, 22, 2, 5);
        }
        c.fillStyle = color;
        c.fillRect(5, 11, 22, 11);
        c.fillRect(9, 9, 13, 15);
        c.fillRect(25, 13, 4, 7);
        c.fillStyle = "#241a35";
        c.fillRect(7, 12, 4, 9);
        c.fillRect(13, 13, 4, 7);
        c.fillStyle = "#06c4ff";
        c.fillRect(20, 14, 2, 5);
        c.fillRect(18, 16, 6, 1);
        return tile;
      });
      cache.set(color, frames);
    }
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    ctx.rotate(body);
    ctx.drawImage(frames[Math.floor(tread) % 2]!, -16, -16);
    ctx.rotate(turret - body);
    ctx.fillStyle = flash ? "#fff8d4" : color;
    ctx.fillRect(-7, -6, 14, 12);
    ctx.fillRect(-5, -8, 10, 16);
    ctx.fillRect(4 - recoil, -2, 19, 4);
    ctx.fillStyle = "#241a35";
    ctx.fillRect(-4, -4, 5, 8);
    ctx.fillRect(20 - recoil, -2, 3, 4);
    if (recoil > 1) {
      ctx.fillStyle = "#cdde00";
      ctx.fillRect(26 - recoil, -3, 5, 6);
    }
    ctx.restore();
  };
}
